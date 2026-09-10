#include <algorithm>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <limits>
#include <map>
#include <numeric>
#include <queue>
#include <sstream>
#include <string>
#include <vector>

using namespace std;

struct Process {
    string pid, deadline_type;
    double arrival{}, burst{}, deadline{};
    int priority{}, affinity{-1}, index{};
};

struct Segment { int core{}; string pid; double start{}, end{}; };
struct ProcResult { double first{-1}, completion{}, waiting{}, turnaround{}, response{}; };

static string esc(const string& s) {
    string out;
    for (char c : s) {
        if (c == '\\' || c == '"') out += '\\';
        out += c;
    }
    return out;
}

static void add_segment(vector<Segment>& out, int core, const string& pid, double start, double end) {
    if (end <= start + 1e-9) return;
    if (!out.empty() && out.back().core == core && out.back().pid == pid && fabs(out.back().end - start) < 1e-9) {
        out.back().end = end;
    } else out.push_back({core, pid, start, end});
}

static vector<Segment> schedule_core(const vector<Process>& p, int core, const string& algorithm, double quantum) {
    vector<Segment> out;
    if (p.empty()) return out;
    vector<double> rem(p.size());
    for (size_t i = 0; i < p.size(); ++i) rem[i] = p[i].burst;
    double t = min_element(p.begin(), p.end(), [](auto& a, auto& b){ return a.arrival < b.arrival; })->arrival;
    int completed = 0;

    auto next_arrival = [&]() {
        double n = numeric_limits<double>::infinity();
        for (size_t i = 0; i < p.size(); ++i) if (rem[i] > 1e-9) n = min(n, p[i].arrival);
        return n;
    };
    auto available = [&]() {
        vector<int> ids;
        for (size_t i = 0; i < p.size(); ++i) if (rem[i] > 1e-9 && p[i].arrival <= t + 1e-9) ids.push_back((int)i);
        return ids;
    };

    if (algorithm == "FCFS" || algorithm == "SJF" || algorithm == "PRIORITY") {
        while (completed < (int)p.size()) {
            auto ids = available();
            if (ids.empty()) { t = max(t, next_arrival()); continue; }
            int best = ids[0];
            for (int i : ids) {
                bool take = false;
                if (algorithm == "FCFS") take = tie(p[i].arrival, p[i].index) < tie(p[best].arrival, p[best].index);
                else if (algorithm == "SJF") take = tie(p[i].burst, p[i].arrival, p[i].index) < tie(p[best].burst, p[best].arrival, p[best].index);
                else take = tie(p[i].priority, p[i].arrival, p[i].index) < tie(p[best].priority, p[best].arrival, p[best].index);
                if (take) best = i;
            }
            add_segment(out, core, p[best].pid, t, t + rem[best]);
            t += rem[best]; rem[best] = 0; completed++;
        }
        return out;
    }

    if (algorithm == "SRTF") {
        while (completed < (int)p.size()) {
            auto ids = available();
            if (ids.empty()) { t = max(t, next_arrival()); continue; }
            int best = *min_element(ids.begin(), ids.end(), [&](int a, int b) {
                return tie(rem[a], p[a].arrival, p[a].index) < tie(rem[b], p[b].arrival, p[b].index);
            });
            double next = numeric_limits<double>::infinity();
            for (size_t i = 0; i < p.size(); ++i) if (rem[i] > 1e-9 && p[i].arrival > t + 1e-9) next = min(next, p[i].arrival);
            double run = rem[best];
            if (isfinite(next)) run = min(run, next - t);
            add_segment(out, core, p[best].pid, t, t + run);
            t += run; rem[best] -= run;
            if (rem[best] <= 1e-9) { rem[best] = 0; completed++; }
        }
        return out;
    }

    struct Item { int id, level; };
    vector<bool> admitted(p.size(), false);
    queue<Item> q[3];
    auto admit = [&]() {
        vector<int> ids;
        for (size_t i = 0; i < p.size(); ++i) if (!admitted[i] && p[i].arrival <= t + 1e-9) ids.push_back((int)i);
        sort(ids.begin(), ids.end(), [&](int a, int b){ return tie(p[a].arrival,p[a].index) < tie(p[b].arrival,p[b].index); });
        for (int i : ids) { q[0].push({i,0}); admitted[i] = true; }
    };
    while (completed < (int)p.size()) {
        admit();
        int level = -1;
        for (int l = 0; l < 3; ++l) if (!q[l].empty()) { level = l; break; }
        if (level < 0) { t = max(t, next_arrival()); continue; }
        Item item = q[level].front(); q[level].pop();
        double slice = algorithm == "RR" ? quantum : quantum * (1 << level);
        double run = min(rem[item.id], max(0.1, slice));
        add_segment(out, core, p[item.id].pid, t, t + run);
        t += run; rem[item.id] -= run; admit();
        if (rem[item.id] <= 1e-9) { rem[item.id] = 0; completed++; }
        else q[algorithm == "MLFQ" ? min(2, level + 1) : 0].push({item.id, algorithm == "MLFQ" ? min(2, level + 1) : 0});
    }
    return out;
}

int main() {
    ios::sync_with_stdio(false); cin.tie(nullptr);
    string algorithm; int cores, count; double quantum;
    if (!(cin >> algorithm >> cores >> quantum >> count)) return 2;
    cores = max(1, min(16, cores));
    vector<Process> all(count);
    for (int i = 0; i < count; ++i) {
        auto& p = all[i]; p.index = i;
        if (!(cin >> p.pid >> p.arrival >> p.burst >> p.priority >> p.deadline >> p.deadline_type >> p.affinity)) return 3;
    }

    vector<vector<Process>> assigned(cores);
    vector<double> load(cores, 0);
    for (const auto& p : all) {
        int c = p.affinity >= 0 && p.affinity < cores ? p.affinity : int(min_element(load.begin(), load.end()) - load.begin());
        assigned[c].push_back(p); load[c] += p.burst;
    }
    vector<Segment> theoretical;
    for (int c = 0; c < cores; ++c) {
        auto seg = schedule_core(assigned[c], c, algorithm, quantum);
        theoretical.insert(theoretical.end(), seg.begin(), seg.end());
    }
    sort(theoretical.begin(), theoretical.end(), [](auto& a, auto& b){ return tie(a.core,a.start) < tie(b.core,b.start); });

    const double switch_cost = 0.5, cache_cost = 10.0;
    vector<Segment> actual;
    vector<double> core_end(cores, 0);
    vector<string> previous(cores);
    int switches = 0;
    map<string, ProcResult> results;
    for (const auto& s : theoretical) {
        bool changed = !previous[s.core].empty() && previous[s.core] != s.pid;
        double overhead = changed ? switch_cost + cache_cost : 0;
        if (changed) switches++;
        double start = max(s.start, core_end[s.core]) + overhead;
        double end = start + (s.end - s.start);
        actual.push_back({s.core, s.pid, start, end});
        auto& r = results[s.pid];
        if (r.first < 0) r.first = start;
        r.completion = max(r.completion, end);
        core_end[s.core] = end; previous[s.core] = s.pid;
    }

    double wait_sum=0, turn_sum=0, response_sum=0, max_latency=0, mean_response=0, missed=0;
    for (const auto& p : all) {
        auto& r = results[p.pid];
        r.turnaround = r.completion - p.arrival;
        r.waiting = max(0.0, r.turnaround - p.burst);
        r.response = max(0.0, r.first - p.arrival);
        wait_sum += r.waiting; turn_sum += r.turnaround; response_sum += r.response;
        max_latency = max(max_latency, r.turnaround); mean_response += r.response;
        if (r.completion > p.arrival + p.deadline + 1e-9) missed++;
    }
    if (count) mean_response /= count;
    double jitter = 0;
    for (const auto& p : all) jitter += pow(results[p.pid].response - mean_response, 2);
    if (count) jitter = sqrt(jitter / count);
    double useful = accumulate(all.begin(), all.end(), 0.0, [](double v, const Process& p){ return v + p.burst; });
    double elapsed = core_end.empty() ? 0 : *max_element(core_end.begin(), core_end.end());

    cout << fixed << setprecision(3) << "{\"gantt\":[";
    for (size_t i=0;i<actual.size();++i) { if(i) cout<<','; auto&s=actual[i]; cout<<"{\"core\":"<<s.core<<",\"pid\":\""<<esc(s.pid)<<"\",\"start\":"<<s.start<<",\"end\":"<<s.end<<"}"; }
    cout << "],\"processes\":[";
    for (size_t i=0;i<all.size();++i) {
        if(i) cout<<',';
        auto&p=all[i]; auto&r=results[p.pid]; double due=p.arrival+p.deadline; bool met=r.completion<=due+1e-9;
        cout<<"{\"pid\":\""<<esc(p.pid)<<"\",\"arrival\":"<<p.arrival<<",\"burst\":"<<p.burst<<",\"completion\":"<<r.completion<<",\"waiting\":"<<r.waiting<<",\"turnaround\":"<<r.turnaround<<",\"response_time\":"<<r.response<<",\"absolute_deadline\":"<<due<<",\"deadline_type\":\""<<esc(p.deadline_type)<<"\",\"deadline_status\":\""<<(met?"DEADLINE_MET":"DEADLINE_MISSED")<<"\",\"missed_by\":"<<(met?0:r.completion-due)<<"}";
    }
    cout << "],\"metrics\":{\"avg_waiting_time\":"<<(count?wait_sum/count:0)<<",\"avg_turnaround_time\":"<<(count?turn_sum/count:0)<<",\"avg_response_time\":"<<(count?response_sum/count:0)<<",\"max_latency\":"<<max_latency<<",\"response_jitter\":"<<jitter<<",\"deadline_miss_rate\":"<<(count?missed*100/count:0)<<",\"context_switches\":"<<switches<<",\"cache_misses\":"<<switches<<",\"useful_work\":"<<useful<<",\"context_switch_overhead\":"<<switches*switch_cost<<",\"cache_penalty\":"<<switches*cache_cost<<",\"actual_elapsed_time\":"<<elapsed<<"}}";
}
