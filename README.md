# RTBench

RTBench is a pre-hardware scheduler validation console for embedded systems engineers. It models real-time workloads on ARM or x86 targets with 1–16 cores, runs six deterministic CPU scheduling algorithms, and surfaces deadline risk, latency, jitter, context switches, and estimated cache overhead.

## What is included

- Native C++17 engine: FCFS, SJF, SRTF, Round Robin, Priority, and MLFQ
- Static multi-core assignment with optional per-task core affinity
- Hard/soft deadline audit with exact lateness per task
- Context-switch (0.5 ms) and cold-cache (10 ms) cost model
- Flask JSON API with SQLAlchemy persistence
- Four seeded embedded profiles: IoT sensor, drone control, automotive ECU, and data logger
- Six-algorithm comparison and rule-based engineering recommendations
- Responsive HTML/CSS/JavaScript validation console
- Docker image, persistent Compose volume, migrations, and automated tests

## Run with Docker

```bash
docker compose up --build
```

Open <http://localhost:8000>. Data is retained in the `rtbench-data` volume.

## Run locally

Prerequisites: Python 3.11+, a C++17 compiler, and `make`.

```bash
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
make build
flask --app app run --port 8000
```

The application creates `instance/rtbench.db` and seeds the four profiles on first launch.

## Test

```bash
pytest -q
```

## API

`POST /api/simulate`

```json
{
  "hardware": {"name": "Flight Controller", "num_cores": 2, "memory_mb": 512, "architecture": "ARM"},
  "algorithm": "RR",
  "quantum": 4,
  "workload": [
    {"pid": "MOTOR", "arrival": 0, "burst": 3, "priority": 1, "deadline": 10, "deadline_type": "hard", "core_affinity": 0}
  ],
  "save": true
}
```

Other endpoints:

- `POST /api/compare`
- `GET|POST /api/hardware-configs`
- `GET|POST /api/workload-profiles`
- `GET /api/simulation-runs/:id`
- `GET /health`

Deadlines are offsets from each task's arrival: `absolute deadline = arrival + deadline`. Priority value `1` is highest. Affinity `-1` lets the simulator choose a core.

## Modeling scope

RTBench is intentionally deterministic and explainable. Multi-core scheduling uses static assignment; task migration and NUMA are out of scope. Switch and cache penalties are configurable in source and deliberately conservative defaults. Results help shortlist configurations, but on-target worst-case execution-time testing remains required for production certification.
