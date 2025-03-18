import os
import json

# Load configuration from ./config/main.json and get the max_concurrent_dl value.
CONFIG_PATH = './config/main.json'

try:
    with open(CONFIG_PATH, 'r') as f:
        config_data = json.load(f)
    MAX_CONCURRENT_DL = config_data.get("maxConcurrentDownloads", 3)
    MAX_RETRIES = config_data.get("maxRetries", 3)
    RETRY_DELAY = config_data.get("retryDelaySeconds", 5)
    RETRY_DELAY_INCREASE = config_data.get("retry_delay_increase", 5)
except Exception as e:
    print(f"Error loading configuration: {e}")
    # Fallback to default values if there's an error reading the config.
    MAX_CONCURRENT_DL = 3
    MAX_RETRIES = 3
    RETRY_DELAY = 5
    RETRY_DELAY_INCREASE = 5

def get_config_params():
    """
    Get common download parameters from the config file.
    This centralizes parameter retrieval and reduces redundancy in API calls.
    
    Returns:
        dict: A dictionary containing common parameters from config
    """
    try:
        with open(CONFIG_PATH, 'r') as f:
            config = json.load(f)
            
        return {
            'service': config.get('service', 'spotify'),
            'spotify': config.get('spotify', ''),
            'deezer': config.get('deezer', ''),
            'fallback': config.get('fallback', False),
            'spotifyQuality': config.get('spotifyQuality', 'NORMAL'),
            'deezerQuality': config.get('deezerQuality', 'MP3_128'),
            'realTime': config.get('realTime', False),
            'customDirFormat': config.get('customDirFormat', '%ar_album%/%album%'),
            'customTrackFormat': config.get('customTrackFormat', '%tracknum%. %music%'),
            'tracknum_padding': config.get('tracknum_padding', True),
            'maxRetries': config.get('maxRetries', 3),
            'retryDelaySeconds': config.get('retryDelaySeconds', 5),
            'retry_delay_increase': config.get('retry_delay_increase', 5)
        }
    except Exception as e:
        print(f"Error reading config for parameters: {e}")
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
            'maxRetries': 3,
            'retryDelaySeconds': 5,
            'retry_delay_increase': 5
        }

# Celery configuration
REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
REDIS_BACKEND = os.environ.get('REDIS_BACKEND', 'redis://localhost:6379/0')

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