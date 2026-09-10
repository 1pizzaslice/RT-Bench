import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, scoped_session, sessionmaker

ROOT = Path(__file__).resolve().parent
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{ROOT / 'instance' / 'rtbench.db'}")
SCHEDULER_BIN = Path(os.getenv("SCHEDULER_BIN", ROOT / "bin" / "scheduler"))
ALGORITHMS = ("FCFS", "SJF", "SRTF", "RR", "PRIORITY", "MLFQ")


class Base(DeclarativeBase):
    pass


class HardwareConfig(Base):
    __tablename__ = "hardware_configs"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    num_cores: Mapped[int] = mapped_column(Integer)
    memory_mb: Mapped[int] = mapped_column(Integer)
    architecture: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class WorkloadProfile(Base):
    __tablename__ = "workload_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    processes_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class SimulationRun(Base):
    __tablename__ = "simulation_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    hardware_id: Mapped[int | None] = mapped_column(ForeignKey("hardware_configs.id"), nullable=True)
    workload_id: Mapped[int | None] = mapped_column(ForeignKey("workload_profiles.id"), nullable=True)
    algorithm: Mapped[str] = mapped_column(String(16))
    results_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


app = Flask(__name__)
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
Session = scoped_session(sessionmaker(bind=engine))


def profile_processes(kind):
    def p(pid, arrival, burst, priority, deadline, deadline_type="soft", affinity=-1):
        return {"pid": pid, "arrival": arrival, "burst": burst, "priority": priority,
                "deadline": deadline, "deadline_type": deadline_type, "core_affinity": affinity}
    if kind == "IoT_Sensor":
        return [p(f"SENSOR_{i+1}", i * 10, 2, 3, 100) for i in range(10)]
    if kind == "Drone_Control":
        return [p("MOTOR_1", 0, 3, 1, 10, "hard", 0), p("MOTOR_2", 10, 3, 1, 10, "hard", 0),
                p("FUSION_1", 0, 6, 2, 20, "hard"), p("FUSION_2", 20, 6, 2, 20, "hard"),
                p("TELEMETRY", 0, 8, 5, 100)]
    if kind == "Automotive_ECU":
        return [p("ENGINE_1", 0, 2, 1, 5, "hard", 0), p("ENGINE_2", 5, 2, 1, 5, "hard", 0),
                p("ENGINE_3", 10, 2, 1, 5, "hard", 0), p("TRANSMISSION", 0, 7, 2, 20, "hard"),
                p("ABS_DIAG", 4, 5, 2, 15, "hard"), p("INFOTAINMENT", 0, 15, 7, 100)]
    return [p(f"LOG_{i+1}", i * 3, 7 + i % 3, 5, 80) for i in range(8)]


PROFILE_DESCRIPTIONS = {
    "IoT_Sensor": "100 sensor reads/sec · I/O-bound · 100 ms soft deadline",
    "Drone_Control": "10 ms motor loop · sensor fusion · hard real-time",
    "Automotive_ECU": "Engine and transmission control mixed with batch work",
    "Data_Logger": "High-throughput logging with flexible deadlines",
}


def init_database():
    (ROOT / "instance").mkdir(exist_ok=True)
    Base.metadata.create_all(engine)
    # Gunicorn workers can boot concurrently. Seed each profile independently so
    # a second worker safely loses the unique-name race without failing startup.
    for name, description in PROFILE_DESCRIPTIONS.items():
        with Session() as db:
            if not db.scalar(select(WorkloadProfile.id).where(WorkloadProfile.name == name)):
                db.add(WorkloadProfile(name=name, description=description,
                                       processes_json=json.dumps(profile_processes(name))))
                try:
                    db.commit()
                except IntegrityError:
                    db.rollback()


def serialize_hardware(row):
    return {"id": row.id, "name": row.name, "num_cores": row.num_cores,
            "memory_mb": row.memory_mb, "architecture": row.architecture,
            "created_at": row.created_at.isoformat()}


def serialize_profile(row):
    return {"id": row.id, "name": row.name, "description": row.description,
            "processes": json.loads(row.processes_json), "created_at": row.created_at.isoformat()}


def validate_hardware(value):
    value = value or {}
    cores = int(value.get("num_cores", 1))
    memory = int(value.get("memory_mb", 512))
    architecture = str(value.get("architecture", "ARM")).upper()
    if not 1 <= cores <= 16:
        raise ValueError("num_cores must be between 1 and 16")
    if memory < 16 or memory > 1_048_576:
        raise ValueError("memory_mb must be between 16 and 1048576")
    if architecture not in ("ARM", "X86"):
        raise ValueError("architecture must be ARM or x86")
    return {"name": str(value.get("name", "Ad-hoc target"))[:100], "num_cores": cores,
            "memory_mb": memory, "architecture": architecture}


def validate_workload(items):
    if not isinstance(items, list) or not items or len(items) > 500:
        raise ValueError("workload must contain 1 to 500 processes")
    clean, seen = [], set()
    for i, raw in enumerate(items):
        pid = str(raw.get("pid", f"P{i+1}")).strip().replace(" ", "_")[:40]
        if not pid or pid in seen or not all(c.isalnum() or c in "_-" for c in pid):
            raise ValueError("process PIDs must be unique and contain only letters, numbers, _ or -")
        seen.add(pid)
        row = {"pid": pid, "arrival": float(raw.get("arrival", 0)), "burst": float(raw.get("burst", 0)),
               "priority": int(raw.get("priority", 5)), "deadline": float(raw.get("deadline", 0)),
               "deadline_type": str(raw.get("deadline_type", "soft")).lower(),
               "core_affinity": int(raw.get("core_affinity", -1))}
        if row["arrival"] < 0 or row["burst"] <= 0 or row["deadline"] <= 0:
            raise ValueError(f"{pid}: arrival must be >= 0; burst and deadline must be > 0")
        if row["deadline_type"] not in ("hard", "soft"):
            raise ValueError(f"{pid}: deadline_type must be hard or soft")
        clean.append(row)
    return clean


def ensure_scheduler():
    source = ROOT / "src" / "scheduler.cpp"
    if SCHEDULER_BIN.exists() and SCHEDULER_BIN.stat().st_mtime >= source.stat().st_mtime:
        return
    SCHEDULER_BIN.parent.mkdir(exist_ok=True)
    subprocess.run([os.getenv("CXX", "g++"), "-std=c++17", "-O2", str(source), "-o", str(SCHEDULER_BIN)],
                   check=True, capture_output=True, text=True)


def recommendations(result, algorithm, hardware, process_count, quantum):
    m = result["metrics"]
    tips = []
    if m["deadline_miss_rate"] > 10:
        tips.append("Prioritize hard-deadline tasks or evaluate Priority scheduling for this workload.")
    if m["context_switches"] > 1000:
        tips.append("Use CPU affinity or batch small tasks to reduce context-switch pressure.")
    if algorithm == "RR" and m["response_jitter"] > max(1, m["avg_response_time"] * .5):
        tips.append(f"Tune the RR quantum from {quantum:g} ms or use Priority scheduling to reduce response jitter.")
    if m["avg_waiting_time"] > 50 and hardware["num_cores"] == 1:
        tips.append("Evaluate a multi-core target to parallelize the current queue.")
    if process_count > hardware["num_cores"] * 2:
        tips.append("The target is oversubscribed; increase cores or reduce the admitted workload.")
    if m["cache_penalty"] > m["useful_work"] * .25:
        tips.append("Pin related tasks to cores or increase time slices to improve cache locality.")
    if m["deadline_miss_rate"] == 0:
        tips.append("All deadlines pass in this model; validate with worst-case burst times before deployment.")
    if hardware["memory_mb"] < process_count * 8:
        tips.append("Memory headroom is low; measure each task's working set on the target.")
    defaults = ["Run the workload with worst-case execution times, not only nominal burst values.",
                "Repeat validation after changing task periods, priorities, or target hardware."]
    for tip in defaults:
        if len(tips) >= 3: break
        tips.append(tip)
    return tips[:5]


def run_scheduler(workload, algorithm, hardware, quantum):
    if algorithm not in ALGORITHMS:
        raise ValueError(f"algorithm must be one of {', '.join(ALGORITHMS)}")
    ensure_scheduler()
    lines = [f"{algorithm} {hardware['num_cores']} {quantum} {len(workload)}"]
    for p in workload:
        lines.append(f"{p['pid']} {p['arrival']} {p['burst']} {p['priority']} {p['deadline']} {p['deadline_type']} {p['core_affinity']}")
    proc = subprocess.run([str(SCHEDULER_BIN)], input="\n".join(lines) + "\n", capture_output=True,
                          text=True, timeout=15, check=True)
    result = json.loads(proc.stdout)
    result["algorithm"] = algorithm
    result["hardware"] = hardware
    result["recommendations"] = recommendations(result, algorithm, hardware, len(workload), quantum)
    missed = [p for p in result["processes"] if p["deadline_status"] == "DEADLINE_MISSED"]
    result["deadline_analysis"] = {
        "total": len(workload), "met": len(workload) - len(missed), "missed": len(missed),
        "miss_rate": result["metrics"]["deadline_miss_rate"],
        "messages": [f"Process {p['pid']} missed deadline by {p['missed_by']:.2f} ms" for p in missed],
    }
    return result


def save_run(result, algorithm, hardware_id=None, workload_id=None):
    with Session() as db:
        row = SimulationRun(hardware_id=hardware_id, workload_id=workload_id,
                            algorithm=algorithm, results_json=json.dumps(result))
        db.add(row); db.commit(); db.refresh(row)
        return row.id


@app.errorhandler(ValueError)
def bad_request(error):
    return jsonify({"error": str(error)}), 400


@app.errorhandler(subprocess.SubprocessError)
def scheduler_error(error):
    app.logger.exception("Scheduler process failed")
    return jsonify({"error": "The scheduler engine could not complete this simulation."}), 500


@app.teardown_appcontext
def remove_session(_exception=None):
    Session.remove()


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/api/hardware-configs", methods=["GET", "POST"])
def hardware_configs():
    with Session() as db:
        if request.method == "GET":
            return jsonify([serialize_hardware(x) for x in db.scalars(select(HardwareConfig).order_by(HardwareConfig.id.desc()))])
        data = validate_hardware(request.get_json(silent=True))
        row = HardwareConfig(**data); db.add(row); db.commit(); db.refresh(row)
        return jsonify(serialize_hardware(row)), 201


@app.route("/api/workload-profiles", methods=["GET", "POST"])
def workload_profiles():
    with Session() as db:
        if request.method == "GET":
            return jsonify([serialize_profile(x) for x in db.scalars(select(WorkloadProfile).order_by(WorkloadProfile.id))])
        body = request.get_json(silent=True) or {}
        name = str(body.get("name", "")).strip()[:100]
        if not name: raise ValueError("profile name is required")
        row = WorkloadProfile(name=name, description=str(body.get("description", ""))[:500],
                              processes_json=json.dumps(validate_workload(body.get("processes"))))
        db.add(row); db.commit(); db.refresh(row)
        return jsonify(serialize_profile(row)), 201


@app.post("/api/simulate")
def simulate():
    body = request.get_json(silent=True) or {}
    hardware = validate_hardware(body.get("hardware"))
    workload = validate_workload(body.get("workload"))
    algorithm = str(body.get("algorithm", "RR")).upper()
    quantum = float(body.get("quantum", 4))
    if quantum <= 0: raise ValueError("quantum must be greater than 0")
    result = run_scheduler(workload, algorithm, hardware, quantum)
    if body.get("save", True):
        result["run_id"] = save_run(result, algorithm, body.get("hardware_id"), body.get("workload_id"))
    return jsonify(result)


@app.post("/api/compare")
def compare():
    body = request.get_json(silent=True) or {}
    hardware = validate_hardware(body.get("hardware"))
    workload = validate_workload(body.get("workload"))
    quantum = float(body.get("quantum", 4))
    results = [run_scheduler(workload, algorithm, hardware, quantum) for algorithm in ALGORITHMS]
    keys = {"avg_waiting_time": "min", "avg_turnaround_time": "min", "deadline_miss_rate": "min",
            "context_switches": "min", "max_latency": "min"}
    best = {key: min(results, key=lambda r: r["metrics"][key])["algorithm"] for key in keys}
    winner = min(results, key=lambda r: (r["metrics"]["deadline_miss_rate"], r["metrics"]["max_latency"], r["metrics"]["avg_waiting_time"]))
    return jsonify({"results": results, "best": best, "recommended_algorithm": winner["algorithm"],
                    "summary": f"{winner['algorithm']} is the strongest fit: lowest deadline risk, then latency."})


@app.get("/api/simulation-runs/<int:run_id>")
def simulation_run(run_id):
    with Session() as db:
        row = db.get(SimulationRun, run_id)
        if not row: return jsonify({"error": "simulation run not found"}), 404
        return jsonify({"id": row.id, "hardware_id": row.hardware_id, "workload_id": row.workload_id,
                        "algorithm": row.algorithm, "results": json.loads(row.results_json),
                        "created_at": row.created_at.isoformat()})


init_database()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8000")), debug=os.getenv("FLASK_DEBUG") == "1")
