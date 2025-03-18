# Use an official Python runtime as a parent image
FROM python:3.12-slim

# Set the working directory in the container
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gosu \
    git \
    redis-server \
    ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create necessary directories with proper permissions
RUN mkdir -p downloads config creds logs && \
    chmod 777 downloads config creds logs

# Make entrypoint script executable
RUN chmod +x entrypoint.sh

# Set entrypoint to our script
ENTRYPOINT ["/app/entrypoint.sh"]

# No CMD needed as entrypoint.sh handles application startup
