CREATE TABLE hardware_configs (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    num_cores INTEGER NOT NULL CHECK (num_cores BETWEEN 1 AND 16),
    memory_mb INTEGER NOT NULL,
    architecture VARCHAR(16) NOT NULL,
    created_at DATETIME NOT NULL
);

CREATE TABLE workload_profiles (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    processes_json TEXT NOT NULL,
    created_at DATETIME NOT NULL
);

CREATE TABLE simulation_runs (
    id INTEGER PRIMARY KEY,
    hardware_id INTEGER REFERENCES hardware_configs(id),
    workload_id INTEGER REFERENCES workload_profiles(id),
    algorithm VARCHAR(16) NOT NULL,
    results_json TEXT NOT NULL,
    created_at DATETIME NOT NULL
);
