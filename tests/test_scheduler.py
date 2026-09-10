import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def scheduler(tmp_path_factory):
    binary = tmp_path_factory.mktemp("bin") / "scheduler"
    subprocess.run(["g++", "-std=c++17", "-O2", str(ROOT / "src" / "scheduler.cpp"), "-o", str(binary)], check=True)
    return binary


def run(binary, header, processes):
    result = subprocess.run([str(binary)], input="\n".join([header, *processes]) + "\n",
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def test_detects_met_and_missed_deadlines(scheduler):
    data = run(scheduler, "FCFS 1 4 2", [
        "P1 0 4 1 10 hard -1",
        "P2 0 4 2 5 hard -1",
    ])
    statuses = {p["pid"]: p for p in data["processes"]}
    assert statuses["P1"]["deadline_status"] == "DEADLINE_MET"
    assert statuses["P2"]["deadline_status"] == "DEADLINE_MISSED"
    assert statuses["P2"]["missed_by"] == pytest.approx(13.5)
    assert data["metrics"]["deadline_miss_rate"] == 50


def test_multicore_rr_assigns_work_to_both_cores(scheduler):
    data = run(scheduler, "RR 2 2 4", [
        "P1 0 4 1 100 soft -1", "P2 0 4 1 100 soft -1",
        "P3 0 4 1 100 soft -1", "P4 0 4 1 100 soft -1",
    ])
    assert {segment["core"] for segment in data["gantt"]} == {0, 1}
    assert data["metrics"]["useful_work"] == 16
    assert data["metrics"]["context_switches"] > 0


@pytest.mark.parametrize("algorithm", ["FCFS", "SJF", "SRTF", "RR", "PRIORITY", "MLFQ"])
def test_all_algorithms_return_complete_metrics(scheduler, algorithm):
    data = run(scheduler, f"{algorithm} 1 3 3", [
        "A 0 3 2 30 soft -1", "B 1 2 1 30 soft -1", "C 2 4 3 30 soft -1",
    ])
    assert len(data["processes"]) == 3
    assert data["metrics"]["avg_turnaround_time"] >= 0
    assert all(p["completion"] > p["arrival"] for p in data["processes"])
