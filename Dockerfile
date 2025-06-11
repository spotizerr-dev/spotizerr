# Stage 1: TypeScript build
FROM node:22.16.0-slim AS typescript-builder

# Set working directory
WORKDIR /app

# Copy necessary files for TypeScript build
COPY tsconfig.json ./tsconfig.json
COPY src/js ./src/js

# Install TypeScript globally
RUN npm install -g typescript

# Compile TypeScript
RUN tsc

# Stage 2: Final image
FROM python:3.12-slim AS python-builder
LABEL org.opencontainers.image.source="https://github.com/Xoconoch/spotizerr"

# Set the working directory in the container
WORKDIR /app

# Install system dependencies, including Node.js and npm (for pnpm)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gosu \
    git \
    ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN npm install -g pnpm

# --- Backend Python Dependencies ---
# Copy only the requirements file to leverage Docker cache
COPY requirements.txt .
# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- Frontend Node.js Dependencies ---
# Copy package manager files to leverage Docker cache
COPY spotizerr-ui/package.json spotizerr-ui/pnpm-lock.yaml ./spotizerr-ui/
# Install frontend dependencies
RUN cd spotizerr-ui && pnpm install --frozen-lockfile

# --- Application Code & Frontend Build ---
# Copy the rest of the application code
COPY . .
# Build the frontend application
RUN cd spotizerr-ui && pnpm build

# --- Final Container Setup ---
# Create necessary directories with proper permissions
RUN mkdir -p downloads data/config data/creds data/watch data/history logs/tasks && \
    chmod -R 777 downloads data logs

# Make entrypoint script executable
RUN chmod +x entrypoint.sh

# Set entrypoint to our script
ENTRYPOINT ["/app/entrypoint.sh"]

# No CMD needed as entrypoint.sh handles application startup
