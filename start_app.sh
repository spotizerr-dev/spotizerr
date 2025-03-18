#!/bin/bash

# Start Flask app in the background
echo "Starting Flask application..."
python app.py &

# Wait a moment for Flask to initialize
sleep 2

# Start Celery worker
echo "Starting Celery worker..."
celery -A routes.utils.celery_tasks.celery_app worker --loglevel=info --concurrency=${MAX_CONCURRENT_DL:-3} -Q downloads &

# Keep the script running
wait 