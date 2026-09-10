FROM python:3.13-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY src/scheduler.cpp src/scheduler.cpp
RUN mkdir -p bin && g++ -std=c++17 -O2 src/scheduler.cpp -o bin/scheduler

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 SCHEDULER_BIN=/app/bin/scheduler DATABASE_URL=sqlite:////data/rtbench.db
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=builder /app/bin/scheduler bin/scheduler
COPY app.py .
COPY templates templates
COPY static static
COPY migrations migrations
RUN mkdir -p /data && useradd --create-home rtbench && chown -R rtbench:rtbench /app /data
USER rtbench
EXPOSE 8000
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "4", "--timeout", "30", "app:app"]
