import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from app import app  # noqa: E402


def client():
    app.config.update(TESTING=True)
    return app.test_client()


def workload():
    return [
        {"pid": "FAST", "arrival": 0, "burst": 2, "priority": 1, "deadline": 10, "deadline_type": "hard"},
        {"pid": "BATCH", "arrival": 0, "burst": 8, "priority": 5, "deadline": 30, "deadline_type": "soft"},
    ]


def test_seeded_profiles_are_available():
    response = client().get("/api/workload-profiles")
    assert response.status_code == 200
    assert {p["name"] for p in response.get_json()} == {"IoT_Sensor", "Drone_Control", "Automotive_ECU", "Data_Logger"}


def test_simulation_response_contract():
    response = client().post("/api/simulate", json={
        "hardware": {"name": "Test", "num_cores": 2, "memory_mb": 256, "architecture": "ARM"},
        "workload": workload(), "algorithm": "RR", "quantum": 2, "save": False,
    })
    assert response.status_code == 200
    body = response.get_json()
    assert body["algorithm"] == "RR"
    assert body["gantt"]
    assert "deadline_analysis" in body
    assert 3 <= len(body["recommendations"]) <= 5


def test_compare_runs_six_algorithms():
    response = client().post("/api/compare", json={
        "hardware": {"num_cores": 1, "memory_mb": 256, "architecture": "x86"},
        "workload": workload(), "quantum": 2,
    })
    assert response.status_code == 200
    body = response.get_json()
    assert len(body["results"]) == 6
    assert body["recommended_algorithm"] in {"FCFS", "SJF", "SRTF", "RR", "PRIORITY", "MLFQ"}


def test_invalid_core_count_is_rejected():
    response = client().post("/api/simulate", json={
        "hardware": {"num_cores": 17, "memory_mb": 256, "architecture": "ARM"},
        "workload": workload(), "algorithm": "FCFS",
    })
    assert response.status_code == 400
    assert "num_cores" in response.get_json()["error"]
