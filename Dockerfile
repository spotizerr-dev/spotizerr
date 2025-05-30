# Use an official Python runtime as a parent image
FROM python:3.12-slim

# Set the working directory in the container
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gosu \
    git \
    ffmpeg \
    nodejs \
    npm \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Install TypeScript globally
RUN npm install -g typescript

# Compile TypeScript
# tsc will use tsconfig.json from the current directory (/app)
# It will read from /app/src/js and output to /app/static/js
RUN tsc

# Create necessary directories with proper permissions
RUN mkdir -p downloads data/config data/creds data/watch data/history logs/tasks && \
    chmod -R 777 downloads data logs

# Make entrypoint script executable
RUN chmod +x entrypoint.sh

# Set entrypoint to our script
ENTRYPOINT ["/app/entrypoint.sh"]

# No CMD needed as entrypoint.sh handles application startup
