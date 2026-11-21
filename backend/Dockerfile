# Use an official Python runtime
FROM python:3.12-slim

# Prevent Python from creating .pyc files
ENV PYTHONDONTWRITEBYTECODE=1

# Send Python output directly to the terminal
ENV PYTHONUNBUFFERED=1

# Working directory inside the container
WORKDIR /app

# Install Python dependencies first (better Docker caching)
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend
COPY . .

# Listen mode's natural English voice: fetch the Woof model (about 41 MB,
# pinned revision; see woof_tts.py). A failed download does not fail the
# build: the app then keeps to the phone's own voice.
RUN python woof_tts.py || echo "Woof model not downloaded; /speak/ will answer 503"

# FastAPI will listen on this port
EXPOSE 8000

# Start the application. One worker process for now; WEB_CONCURRENCY (a
# Railway service variable) raises the number without a code change, so one
# slow request no longer holds up everyone else. Each worker loads its own
# copy of the language models, so memory use grows with it. Workers share
# cache.db (SQLite in WAL mode), which is where quotas, spend and caches live.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WEB_CONCURRENCY:-1}"]