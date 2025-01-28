# Use an official Python runtime as a parent image
FROM python:3.12-slim

# Install system dependencies and gosu for user switching
RUN apt-get update && apt-get install -y git ffmpeg gosu bash && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Copy entrypoint script and make it executable
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose the application port
EXPOSE 7171

# Set entrypoint to handle user permission setup
ENTRYPOINT ["/entrypoint.sh"]
CMD ["python", "app.py"]