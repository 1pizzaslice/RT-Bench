const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let profiles = [], currentProfile = null, architecture = "ARM", lastResult = null;

const sampleTask = (n=1) => ({pid:`TASK_${n}`,arrival:0,burst:5,priority:3,deadline:20,deadline_type:"soft",core_affinity:-1});

function toast(message, error=false){const el=$("#toast");el.textContent=message;el.className=`toast show ${error?"error":""}`;setTimeout(()=>el.className="toast",2600)}
async function api(url, options={}){const response=await fetch(url,{headers:{"Content-Type":"application/json"},...options});const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{throw new Error(response.ok?"Server returned an invalid response":`Server error (${response.status})`)}if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);return data}
function num(v){return Number(v).toFixed(1)}

function taskRow(task){
  const tr=document.createElement("tr");
  tr.innerHTML=`<td><input class="pid" value="${task.pid}"></td><td><input type="number" min="0" step="0.5" data-key="arrival" value="${task.arrival}"></td><td><input type="number" min="0.1" step="0.5" data-key="burst" value="${task.burst}"></td><td><input type="number" min="1" data-key="priority" value="${task.priority}"></td><td><input type="number" min="0.1" step="0.5" data-key="deadline" value="${task.deadline}"></td><td><select data-key="deadline_type"><option ${task.deadline_type==="soft"?"selected":""}>soft</option><option ${task.deadline_type==="hard"?"selected":""}>hard</option></select></td><td><input type="number" min="-1" max="15" data-key="core_affinity" value="${task.core_affinity??-1}" title="-1 = automatic"></td><td><button class="remove-task" aria-label="Remove task">×</button></td>`;
  tr.querySelector(".remove-task").onclick=()=>{tr.remove();updateCount()}; return tr;
}
function setTasks(tasks,name="Custom workload"){$("#taskRows").replaceChildren(...tasks.map(taskRow));$("#workloadName").textContent=name;updateCount()}
function updateCount(){$("#taskCount").textContent=`${$$('#taskRows tr').length} TASKS`}
function getTasks(){return $$("#taskRows tr").map(tr=>({pid:tr.querySelector(".pid").value.trim(),arrival:+tr.querySelector('[data-key="arrival"]').value,burst:+tr.querySelector('[data-key="burst"]').value,priority:+tr.querySelector('[data-key="priority"]').value,deadline:+tr.querySelector('[data-key="deadline"]').value,deadline_type:tr.querySelector('[data-key="deadline_type"]').value,core_affinity:+tr.querySelector('[data-key="core_affinity"]').value}))}
function hardware(){return {name:$("#hardwareName").value,num_cores:+$("#cores").value,memory_mb:+$("#memory").value,architecture}}

async function boot(){
  try{
    const [profileData, hardwareData]=await Promise.all([api("/api/workload-profiles"),api("/api/hardware-configs")]); profiles=profileData;
    $("#profiles").replaceChildren(...profiles.map((p,i)=>{const b=document.createElement("button");b.className=`profile-card ${i===0?"active":""}`;b.innerHTML=`<b>${p.name.replaceAll('_',' ')}</b><p>${p.description}</p><span>${p.processes.length} REPRESENTATIVE TASKS</span>`;b.onclick=()=>selectProfile(p,b);return b}));
    hardwareData.forEach(h=>{const o=new Option(`${h.name} · ${h.num_cores}C ${h.architecture}`,h.id);o.dataset.value=JSON.stringify(h);$("#hardwarePreset").append(o)});
    if(profiles[0])selectProfile(profiles[0],$(".profile-card"));else setTasks([sampleTask()]);
  }catch(e){toast(e.message,true);setTasks([sampleTask()])}
}
function selectProfile(p,el){currentProfile=p;$$('.profile-card').forEach(x=>x.classList.remove('active'));el?.classList.add('active');setTasks(structuredClone(p.processes),p.name.replaceAll('_',' '))}

$$('[data-arch]').forEach(b=>b.onclick=()=>{architecture=b.dataset.arch;$$('[data-arch]').forEach(x=>x.classList.toggle('active',x===b))});
$("#quantum").oninput=e=>$("#quantumValue").value=`${e.target.value} ms`;
const algorithmCopy={FCFS:['FIRST COME, FIRST SERVED','Runs tasks in arrival order with minimal scheduler complexity.'],SJF:['SHORTEST JOB FIRST','Prioritizes the shortest available burst to reduce average wait.'],SRTF:['SHORTEST REMAINING TIME','Preempts longer tasks when a shorter remaining job becomes ready.'],RR:['ROUND ROBIN','Time-sliced scheduling for predictable fairness and response.'],PRIORITY:['PRIORITY SCHEDULING','Runs the highest-priority ready task first; priority 1 is highest.'],MLFQ:['MULTILEVEL FEEDBACK QUEUE','Adapts time slices across queues to balance response and throughput.']};
$("#algorithm").onchange=e=>{const [label,help]=algorithmCopy[e.target.value];$("#algorithmLabel").textContent=label;$("#algorithmHelp").textContent=help};
$("#hardwarePreset").onchange=e=>{const o=e.target.selectedOptions[0];if(!o.dataset.value)return;const h=JSON.parse(o.dataset.value);$("#hardwareName").value=h.name;$("#cores").value=h.num_cores;$("#memory").value=h.memory_mb;architecture=h.architecture;$$('[data-arch]').forEach(x=>x.classList.toggle('active',x.dataset.arch===architecture))};
$("#addTask").onclick=()=>{$("#taskRows").append(taskRow(sampleTask($$('#taskRows tr').length+1)));updateCount()};
$("#uploadJson").onclick=()=>$("#fileInput").click();
$("#fileInput").onchange=async e=>{try{const data=JSON.parse(await e.target.files[0].text());setTasks(Array.isArray(data)?data:data.processes,data.name||"Imported workload");currentProfile=null;toast("JSON workload imported")}catch{toast("That file is not valid workload JSON",true)}};
$("#saveHardware").onclick=async()=>{try{const h=await api("/api/hardware-configs",{method:"POST",body:JSON.stringify(hardware())});const o=new Option(`${h.name} · ${h.num_cores}C ${h.architecture}`,h.id,true,true);o.dataset.value=JSON.stringify(h);$("#hardwarePreset").append(o);toast("Hardware configuration saved")}catch(e){toast(e.message,true)}};
$("#saveProfile").onclick=async()=>{const name=prompt("Profile name",$("#workloadName").textContent);if(!name)return;try{const p=await api("/api/workload-profiles",{method:"POST",body:JSON.stringify({name,description:"Custom validation workload",processes:getTasks()})});profiles.push(p);toast("Workload profile saved")}catch(e){toast(e.message,true)}};

async function simulate(compare=false){
  const buttons=[$("#runBtn"),$("#compareBtn")];buttons.forEach(b=>b.disabled=true);$("#runStatus").textContent="COMPUTING";
  try{
    const payload={hardware:hardware(),workload:getTasks(),quantum:+$("#quantum").value,workload_id:currentProfile?.id};
    if(compare){const data=await api("/api/compare",{method:"POST",body:JSON.stringify(payload)});renderComparison(data);const selected=data.results.find(r=>r.algorithm===$("#algorithm").value)||data.results[0];renderResult(selected)}
    else{payload.algorithm=$("#algorithm").value;payload.save=true;renderResult(await api("/api/simulate",{method:"POST",body:JSON.stringify(payload)}))}
  }catch(e){toast(e.message,true)}finally{buttons.forEach(b=>b.disabled=false);$("#runStatus").textContent="RUN COMPLETE"}
}
$("#runBtn").onclick=()=>simulate(false);$("#compareBtn").onclick=()=>simulate(true);$("#closeCompare").onclick=()=>$("#comparison").classList.add("hidden");

function renderResult(r){
  lastResult=r;$("#results").classList.remove("hidden");$("#resultAlgorithm").textContent=r.algorithm;$("#runId").textContent=r.run_id?`SAVED RUN #${r.run_id}`:"COMPARISON PREVIEW";
  const m=r.metrics, passed=m.deadline_miss_rate===0, hardMisses=r.processes.filter(p=>p.deadline_type==='hard'&&p.deadline_status==='DEADLINE_MISSED').length;
  $("#verdict").className=`verdict ${passed?'pass':'risk'}`;$("#verdictIcon").textContent=passed?'✓':'!';
  $("#verdictTitle").textContent=passed?'Workload is schedulable in this model':`${r.deadline_analysis.missed} deadline${r.deadline_analysis.missed===1?'':'s'} require attention`;
  $("#verdictText").textContent=passed?'Every task completed within its modeled deadline window.':'Review the highlighted tasks before selecting this scheduler for deployment.';
  $("#verdictMeta").innerHTML=`<span>TARGET<b>${r.hardware.num_cores} cores · ${r.hardware.architecture}</b></span><span>POLICY<b>${r.algorithm} · Q${$("#quantum").value} ms</b></span><span>HARD MISSES<b>${hardMisses}</b></span>`;
  const data=[['Average wait',m.avg_waiting_time,'ms','Time queued before CPU service'],['Turnaround',m.avg_turnaround_time,'ms','Arrival to completion'],['Max latency',m.max_latency,'ms','Worst task response window'],['Deadline miss',m.deadline_miss_rate,'%','Tasks completed too late'],['Context switches',m.context_switches,'','Cross-task transitions']];
  $("#metrics").innerHTML=data.map(([l,v,u,h],i)=>`<div class="metric"><div><span>${String(i+1).padStart(2,'0')} · ${l}</span><small>${h}</small></div><b class="${l==='Deadline miss'&&v>0?'danger':''}">${num(v)}<em>${u}</em></b></div>`).join('');
  renderGantt(r);renderDeadlines(r);renderOverhead(m);$("#recommendations").innerHTML=r.recommendations.map(x=>`<li>${x}</li>`).join('');
  $("#results").scrollIntoView({behavior:"smooth",block:"start"});
}
function renderGantt(r){
  const max=Math.max(1,...r.gantt.map(x=>x.end)),status=Object.fromEntries(r.processes.map(p=>[p.pid,p.deadline_status]));let html='';
  const shortPid=pid=>{const parts=pid.split('_');return parts.length>1?`${parts[0][0]}${parts.at(-1)}`:pid.slice(0,3)};
  for(let c=0;c<r.hardware.num_cores;c++){const coreSlices=r.gantt.filter(x=>x.core===c);const slices=coreSlices.map(x=>{const width=(x.end-x.start)/max*100;return `<button type="button" class="slice ${status[x.pid]==='DEADLINE_MISSED'?'missed':''}" style="left:${x.start/max*100}%;width:${width}%" data-tip="${x.pid} · ${num(x.start)}–${num(x.end)} ms" aria-label="${x.pid}, ${num(x.start)} to ${num(x.end)} milliseconds">${width>1.25?shortPid(x.pid):''}</button>`}).join('');html+=`<div class="core-row"><div class="core-label"><b>CORE ${c}</b><span>${coreSlices.length} slices</span></div><div class="track">${slices}</div></div>`}
  html+=`<div class="time-axis"><span>0</span><span>${num(max*.25)}</span><span>${num(max*.5)}</span><span>${num(max*.75)}</span><span>${num(max)} ms</span></div><p class="timeline-hint">Hover or focus a slice to inspect its task and exact execution window.</p>`;$("#gantt").innerHTML=html;
}
function renderDeadlines(r){
  const d=r.deadline_analysis,pass=100-d.miss_rate;$("#deadlineScore").innerHTML=`<div class="score-ring" style="--score:${pass}%"><b>${num(pass)}%</b></div><div><h4>${d.missed?`${d.missed} task${d.missed>1?'s':''} late`:'All deadlines met'}</h4><p>${d.met} of ${d.total} completed on time</p></div>`;
  const sorted=[...r.processes].sort((a,b)=>(a.deadline_status==='DEADLINE_MISSED'?0:1)-(b.deadline_status==='DEADLINE_MISSED'?0:1));
  $("#deadlineList").innerHTML=sorted.map(p=>`<div class="deadline-item ${p.deadline_status==='DEADLINE_MISSED'?'missed':''}"><div><strong>${p.pid}</strong><span>Done ${num(p.completion)} ms · Due ${num(p.absolute_deadline)} ms</span></div><b>${p.deadline_status==='DEADLINE_MISSED'?`+${num(p.missed_by)} ms`:'ON TIME'}</b></div>`).join('');
}
function renderOverhead(m){const total=m.useful_work+m.context_switch_overhead+m.cache_penalty||1,efficiency=m.useful_work/total*100;$("#overhead").innerHTML=`<div class="cost-summary"><div><span>MODELED CPU COST</span><b>${num(total)}<em> ms</em></b></div><div><span>USEFUL-WORK RATIO</span><b>${num(efficiency)}<em>%</em></b></div></div><div class="cost-bar" aria-label="Execution cost breakdown"><span class="cost-work" style="width:${m.useful_work/total*100}%"></span><span class="cost-switch" style="width:${m.context_switch_overhead/total*100}%"></span><span class="cost-cache" style="width:${m.cache_penalty/total*100}%"></span></div><div class="cost-list"><span><i class="cost-work"></i>USEFUL WORK<b>${num(m.useful_work)} ms</b></span><span><i class="cost-switch"></i>SWITCH COST<b>${num(m.context_switch_overhead)} ms</b></span><span><i class="cost-cache"></i>CACHE EFFECTS<b>${num(m.cache_penalty)} ms</b></span></div>`}
function renderComparison(data){
  const metrics=['avg_waiting_time','avg_turnaround_time','max_latency','deadline_miss_rate','context_switches'];$("#comparison").classList.remove("hidden");$("#compareSummary").textContent=data.summary;
  $("#compareRows").innerHTML=data.results.map(r=>`<tr class="${r.algorithm===data.recommended_algorithm?'winner':''}"><td>${r.algorithm}</td>${metrics.map(k=>`<td class="${data.best[k]===r.algorithm?'best':''}">${num(r.metrics[k])}${k==='context_switches'?'':' '+(k==='deadline_miss_rate'?'%':'ms')}</td>`).join('')}</tr>`).join('');
}
boot();
