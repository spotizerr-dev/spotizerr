from flask import Blueprint, jsonify, request
import json
from pathlib import Path
import logging
import threading
import time
import os

config_bp = Blueprint('config_bp', __name__)
CONFIG_PATH = Path('./data/config/main.json')

# Flag for config change notifications
config_changed = False
last_config = {}

# Define parameters that should trigger notification when changed
NOTIFY_PARAMETERS = [
    'maxConcurrentDownloads',
    'service',
    'fallback',
    'spotifyQuality',
    'deezerQuality'
]

def get_config():
    try:
        if not CONFIG_PATH.exists():
            CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            CONFIG_PATH.write_text('{}')
            return {}
            
        with open(CONFIG_PATH, 'r') as f:
            return json.load(f)
    except Exception as e:
        logging.error(f"Error reading config: {str(e)}")
        return None

def save_config(config_data):
    """Save config and track changes to important parameters"""
    global config_changed, last_config
    
    try:
        # Load current config for comparison
        current_config = get_config() or {}
        
        # Check if any notify parameters changed
        for param in NOTIFY_PARAMETERS:
            if param in config_data:
                if param not in current_config or config_data[param] != current_config.get(param):
                    config_changed = True
                    logging.info(f"Config parameter '{param}' changed from '{current_config.get(param)}' to '{config_data[param]}'")
        
        # Save last known config
        last_config = config_data.copy()
        
        # Write the config file
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_PATH, 'w') as f:
            json.dump(config_data, f, indent=2)
            
        return True
    except Exception as e:
        logging.error(f"Error saving config: {str(e)}")
        return False

@config_bp.route('/config', methods=['GET'])
def handle_config():
    config = get_config()
    if config is None:
        return jsonify({"error": "Could not read config file"}), 500
        
    # Create config/state directory
    Path('./data/config/state').mkdir(parents=True, exist_ok=True)
        
    # Set default values for any missing config options
    defaults = {
        'service': 'spotify',  # Default service is Spotify
        'fallback': False,
        'spotifyQuality': 'NORMAL',
        'deezerQuality': 'MP3_128',
        'realTime': False,
        'customDirFormat': '%ar_album%/%album%',
        'customTrackFormat': '%tracknum%. %music%',
        'maxConcurrentDownloads': 3,
        'maxRetries': 3,
        'retryDelaySeconds': 5,
        'retry_delay_increase': 5,
        'tracknum_padding': True
    }
    
    # Populate defaults for any missing keys
    for key, default_value in defaults.items():
        if key not in config:
            config[key] = default_value
    
    # Get explicit filter setting from environment variable
    explicit_filter_env = os.environ.get('EXPLICIT_FILTER', 'false').lower()
    config['explicitFilter'] = explicit_filter_env in ('true', '1', 'yes', 'on')
            
    return jsonify(config)

@config_bp.route('/config', methods=['POST', 'PUT'])
def update_config():
    try:
        new_config = request.get_json()
        if not isinstance(new_config, dict):
            return jsonify({"error": "Invalid config format"}), 400

        # Get existing config to preserve environment-controlled values
        existing_config = get_config() or {}
        
        # Preserve the explicitFilter setting from environment
        explicit_filter_env = os.environ.get('EXPLICIT_FILTER', 'false').lower()
        new_config['explicitFilter'] = explicit_filter_env in ('true', '1', 'yes', 'on')

        if not save_config(new_config):
            return jsonify({"error": "Failed to save config"}), 500
            
        # Return the updated config
        updated_config_values = get_config()
        if updated_config_values is None:
            # This case should ideally not be reached if save_config succeeded
            # and get_config handles errors by returning a default or None.
            return jsonify({"error": "Failed to retrieve configuration after saving"}), 500
            
        return jsonify(updated_config_values)
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON data"}), 400
    except Exception as e:
        logging.error(f"Error updating config: {str(e)}")
        return jsonify({"error": "Failed to update config"}), 500

@config_bp.route('/config/check', methods=['GET'])
def check_config_changes():
    """
    Check if config has changed since last check
    Returns: Status of config changes
    """
    global config_changed
    
    # Get current state
    has_changed = config_changed
    
    # Reset flag after checking
    if has_changed:
        config_changed = False
    
    return jsonify({
        "changed": has_changed,
        "last_config": last_config
    })