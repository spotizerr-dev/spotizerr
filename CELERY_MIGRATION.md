# Migration Guide: File-based Queue to Celery+Redis

This guide explains how to migrate from the file-based queue system to the new Celery+Redis based system for handling download tasks.

## Benefits of the New System

1. **Improved Reliability**: Redis provides reliable persistence for task state
2. **Better Scalability**: Celery workers can be scaled across multiple machines
3. **Enhanced Monitoring**: Built-in tools for monitoring task status and health
4. **Resource Efficiency**: Celery's worker pool is more efficient than Python threads
5. **Cleaner Code**: Separates concerns between queue management and download logic

## Prerequisites

- Redis server (3.0+) installed and running
- Python 3.7+ (same as the main application)
- Required Python packages:
  - celery>=5.3.6
  - redis>=5.0.1
  - flask-celery-helper>=1.1.0

## Installation

1. Install Redis:
   ```bash
   # For Debian/Ubuntu
   sudo apt-get install redis-server
   
   # For Arch Linux
   sudo pacman -S redis
   
   # For macOS
   brew install redis
   ```

2. Start Redis server:
   ```bash
   sudo systemctl start redis
   # or
   redis-server
   ```

3. Install required Python packages:
   ```bash
   pip install -r requirements-celery.txt
   ```

## Configuration

1. Set the Redis URL in environment variables (optional):
   ```bash
   export REDIS_URL=redis://localhost:6379/0
   export REDIS_BACKEND=redis://localhost:6379/0
   ```

2. Adjust `config/main.json` as needed:
   ```json
   {
     "maxConcurrentDownloads": 3, 
     "maxRetries": 3,
     "retryDelaySeconds": 5,
     "retry_delay_increase": 5
   }
   ```

## Starting the Worker

To start the Celery worker:

```bash
python celery_worker.py
```

This will start the worker with the configured maximum concurrent downloads.

## Monitoring

You can monitor tasks using Flower, a web-based Celery monitoring tool:

```bash
pip install flower
celery -A routes.utils.celery_tasks.celery_app flower
```

Then access the dashboard at http://localhost:5555

## Transitioning from File-based Queue

The API endpoints (`/api/prgs/*`) have been updated to be backward compatible and will work with both the old .prg file system and the new Celery-based system. This allows for a smooth transition.

1. During transition, both systems can run in parallel
2. New download requests will use the Celery tasks system
3. Old .prg files will still be accessible via the same API
4. Eventually, the PRG file handling code can be removed once all old tasks are completed

## Modifying Downloader Functions

If you need to add a new downloader function, make these changes:

1. Update the utility module (e.g., track.py) to accept a `progress_callback` parameter
2. Use the progress_callback for reporting progress as shown in the example
3. Create a new Celery task in `routes/utils/celery_tasks.py`

Example of implementing a callback in your downloader function:

```python
def download_track(service="", url="", progress_callback=None, ...):
    """Download a track with progress reporting"""
    
    # Create a default callback if none provided
    if progress_callback is None:
        progress_callback = lambda x: None
    
    # Report initializing status
    progress_callback({
        "status": "initializing",
        "type": "track",
        "song": track_name,
        "artist": artist_name
    })
    
    # Report download progress
    progress_callback({
        "status": "downloading",
        "type": "track",
        "song": track_name,
        "artist": artist_name
    })
    
    # Report real-time progress
    progress_callback({
        "status": "real_time",
        "type": "track",
        "song": track_name,
        "artist": artist_name,
        "percentage": 0.5  # 50% complete
    })
    
    # Report completion
    progress_callback({
        "status": "done",
        "type": "track",
        "song": track_name,
        "artist": artist_name
    })
```

## API Endpoints

The API endpoints remain unchanged to maintain compatibility with the frontend:

- `GET /api/prgs/<task_id>` - Get task/file status (works with both task IDs and old .prg filenames)
- `DELETE /api/prgs/delete/<task_id>` - Delete a task/file
- `GET /api/prgs/list` - List all tasks and files
- `POST /api/prgs/retry/<task_id>` - Retry a failed task
- `POST /api/prgs/cancel/<task_id>` - Cancel a running task

## Error Handling

Errors in Celery tasks are automatically captured and stored in Redis. The task status is updated to "error" and includes the error message and traceback. Tasks can be retried using the `/api/prgs/retry/<task_id>` endpoint. 