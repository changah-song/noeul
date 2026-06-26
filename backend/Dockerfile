# Use an official Python runtime
FROM python:3.12-slim

# Prevent Python from creating .pyc files
ENV PYTHONDONTWRITEBYTECODE=1

# Send Python output directly to the terminal
ENV PYTHONUNBUFFERED=1

# KoNLPy requires a JVM at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-21-jre \
    && rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

# Working directory inside the container
WORKDIR /app

# Install Python dependencies first (better Docker caching)
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend
COPY . .

# FastAPI will listen on this port
EXPOSE 8000

# Start the application
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]