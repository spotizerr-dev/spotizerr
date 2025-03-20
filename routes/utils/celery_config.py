import os
import json
import logging
from pathlib import Path

# Configure logging
logger = logging.getLogger(__name__)

# Redis configuration - read from environment variables
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = os.getenv('REDIS_PORT', '6379')
REDIS_DB = os.getenv('REDIS_DB', '0')
REDIS_URL = os.getenv('REDIS_URL', f"redis://{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}")
REDIS_BACKEND = os.getenv('REDIS_BACKEND', REDIS_URL)

# Log Redis connection details
logger.info(f"Redis configuration: REDIS_URL={REDIS_URL}, REDIS_BACKEND={REDIS_BACKEND}")

# Config path
CONFIG_PATH = './config/main.json'

def get_config_params():
    """
    Get configuration parameters from the config file.
    
    Returns:
        dict: A dictionary containing configuration parameters
    """
    try:
        if not Path(CONFIG_PATH).exists():
            return {
                'service': 'spotify',
                'spotify': '',
                'deezer': '',
                'fallback': False,
                'spotifyQuality': 'NORMAL',
                'deezerQuality': 'MP3_128',
                'realTime': False,
                'customDirFormat': '%ar_album%/%album%',
                'customTrackFormat': '%tracknum%. %music%',
                'tracknum_padding': True,
                'maxConcurrentDownloads': 3,
                'maxRetries': 3,
                'retryDelaySeconds': 5,
                'retry_delay_increase': 5
            }
            
        with open(CONFIG_PATH, 'r') as f:
            config = json.load(f)
            
        # Set defaults for missing values
        defaults = {
            'service': 'spotify',
            'spotify': '',
            'deezer': '',
            'fallback': False,
            'spotifyQuality': 'NORMAL',
            'deezerQuality': 'MP3_128',
            'realTime': False,
            'customDirFormat': '%ar_album%/%album%',
            'customTrackFormat': '%tracknum%. %music%',
            'tracknum_padding': True,
            'maxConcurrentDownloads': 3,
            'maxRetries': 3,
            'retryDelaySeconds': 5,
            'retry_delay_increase': 5
        }
        
        for key, value in defaults.items():
            if key not in config:
                config[key] = value
                
        return config
    except Exception as e:
        logger.error(f"Error reading config: {e}")
        # Return defaults if config read fails
        return {
            'service': 'spotify',
            'spotify': '',
            'deezer': '',
            'fallback': False,
            'spotifyQuality': 'NORMAL',
            'deezerQuality': 'MP3_128',
            'realTime': False,
            'customDirFormat': '%ar_album%/%album%',
            'customTrackFormat': '%tracknum%. %music%',
            'tracknum_padding': True,
            'maxConcurrentDownloads': 3,
            'maxRetries': 3,
            'retryDelaySeconds': 5,
            'retry_delay_increase': 5
        }

# Load configuration values we need for Celery
config = get_config_params()
MAX_CONCURRENT_DL = config.get('maxConcurrentDownloads', 3)
MAX_RETRIES = config.get('maxRetries', 3)
RETRY_DELAY = config.get('retryDelaySeconds', 5)
RETRY_DELAY_INCREASE = config.get('retry_delay_increase', 5)

# Define task queues
task_queues = {
    'default': {
        'exchange': 'default',
        'routing_key': 'default',
    },
    'downloads': {
        'exchange': 'downloads',
        'routing_key': 'downloads',
    }
}

# Set default queue
task_default_queue = 'downloads'
task_default_exchange = 'downloads'
task_default_routing_key = 'downloads'

# Celery task settings
task_serializer = 'json'
accept_content = ['json']
result_serializer = 'json'
enable_utc = True

# Configure worker concurrency based on MAX_CONCURRENT_DL
worker_concurrency = MAX_CONCURRENT_DL

# Configure task rate limiting - these are per-minute limits
task_annotations = {
    'routes.utils.celery_tasks.download_track': {
        'rate_limit': f'{MAX_CONCURRENT_DL}/m',
    },
    'routes.utils.celery_tasks.download_album': {
        'rate_limit': f'{MAX_CONCURRENT_DL}/m',
    },
    'routes.utils.celery_tasks.download_playlist': {
        'rate_limit': f'{MAX_CONCURRENT_DL}/m',
    }
}

# Configure retry settings
task_default_retry_delay = RETRY_DELAY  # seconds
task_max_retries = MAX_RETRIES

# Task result settings
task_track_started = True
result_expires = 60 * 60 * 24 * 7  # 7 days

# Configure visibility timeout for task messages
broker_transport_options = {
    'visibility_timeout': 3600,  # 1 hour
} 