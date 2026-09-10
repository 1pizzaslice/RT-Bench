const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let profiles = [], currentProfile = null, architecture = "ARM", lastResult = null;

const sampleTask = (n=1) => ({pid:`TASK_${n}`,arrival:0,burst:5,priority:3,deadline:20,deadline_type:"soft",core_affinity:-1});

function toast(message, error=false){const el=$("#toast");el.textContent=message;el.className=`toast show ${error?"error":""}`;setTimeout(()=>el.className="toast",2600)}
async function api(url, options={}){const response=await fetch(url,{headers:{"Content-Type":"application/json"},...options});const data=await response.json();if(!response.ok)throw new Error(data.error||"Request failed");return data}
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
  const m=r.metrics, data=[['AVG WAIT',m.avg_waiting_time,'ms'],['AVG TURNAROUND',m.avg_turnaround_time,'ms'],['MAX LATENCY',m.max_latency,'ms'],['DEADLINE MISS',m.deadline_miss_rate,'%'],['CONTEXT SWITCHES',m.context_switches,'']];
  $("#metrics").innerHTML=data.map(([l,v,u])=>`<div class="metric"><span>${l}</span><b class="${l==='DEADLINE MISS'&&v>0?'danger':''}">${num(v)}${u}</b></div>`).join('');
  renderGantt(r);renderDeadlines(r);renderOverhead(m);$("#recommendations").innerHTML=r.recommendations.map(x=>`<li>${x}</li>`).join('');
  $("#results").scrollIntoView({behavior:"smooth",block:"start"});
}
function renderGantt(r){
  const max=Math.max(1,...r.gantt.map(x=>x.end)),status=Object.fromEntries(r.processes.map(p=>[p.pid,p.deadline_status]));let html='';
  for(let c=0;c<r.hardware.num_cores;c++){const slices=r.gantt.filter(x=>x.core===c).map(x=>`<div class="slice ${status[x.pid]==='DEADLINE_MISSED'?'missed':''}" style="left:${x.start/max*100}%;width:${(x.end-x.start)/max*100}%" title="${x.pid}: ${num(x.start)}–${num(x.end)} ms">${x.pid}</div>`).join('');html+=`<div class="core-row"><div class="core-label">CORE ${c}</div><div class="track">${slices}</div></div>`}
  html+=`<div class="time-axis"><span>0 ms</span><span>${num(max/2)} ms</span><span>${num(max)} ms</span></div>`;$("#gantt").innerHTML=html;
}
function renderDeadlines(r){
  const d=r.deadline_analysis,pass=100-d.miss_rate;$("#deadlineScore").innerHTML=`<div class="score-ring" style="--score:${pass}%"><b>${num(pass)}%</b></div><div><h4>${d.missed?`${d.missed} task${d.missed>1?'s':''} late`:'All deadlines met'}</h4><p>${d.met} of ${d.total} completed on time</p></div>`;
  $("#deadlineList").innerHTML=r.processes.map(p=>`<div class="deadline-item ${p.deadline_status==='DEADLINE_MISSED'?'missed':''}"><span>${p.pid} · due ${num(p.absolute_deadline)} ms</span><b>${p.deadline_status==='DEADLINE_MISSED'?`+${num(p.missed_by)} ms`:'MET'}</b></div>`).join('');
}
function renderOverhead(m){const total=m.useful_work+m.context_switch_overhead+m.cache_penalty||1;$("#overhead").innerHTML=`<div class="cost-bar"><span class="cost-work" style="width:${m.useful_work/total*100}%"></span><span class="cost-switch" style="width:${m.context_switch_overhead/total*100}%"></span><span class="cost-cache" style="width:${m.cache_penalty/total*100}%"></span></div><div class="cost-list"><span>USEFUL WORK<b>${num(m.useful_work)} ms</b></span><span>SWITCHES<b>${num(m.context_switch_overhead)} ms</b></span><span>CACHE EFFECTS<b>${num(m.cache_penalty)} ms</b></span></div>`}
function renderComparison(data){
  const metrics=['avg_waiting_time','avg_turnaround_time','max_latency','deadline_miss_rate','context_switches'];$("#comparison").classList.remove("hidden");$("#compareSummary").textContent=data.summary;
  $("#compareRows").innerHTML=data.results.map(r=>`<tr class="${r.algorithm===data.recommended_algorithm?'winner':''}"><td>${r.algorithm}</td>${metrics.map(k=>`<td class="${data.best[k]===r.algorithm?'best':''}">${num(r.metrics[k])}${k==='context_switches'?'':' '+(k==='deadline_miss_rate'?'%':'ms')}</td>`).join('')}</tr>`).join('');
}
boot();
