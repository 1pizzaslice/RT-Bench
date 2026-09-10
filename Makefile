.PHONY: build run test clean

build:
	mkdir -p bin
	g++ -std=c++17 -O2 -Wall -Wextra src/scheduler.cpp -o bin/scheduler

run: build
	flask --app app run --port 8000 --debug

test:
	pytest -q

clean:
	rm -f bin/scheduler instance/rtbench.db
