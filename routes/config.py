from flask import Blueprint, jsonify, request
import json
from pathlib import Path
import logging
import threading
import time
import os

# Import the centralized config getters that handle file creation and defaults
from routes.utils.celery_config import get_config_params as get_main_config_params, DEFAULT_MAIN_CONFIG, CONFIG_FILE_PATH as MAIN_CONFIG_FILE_PATH
from routes.utils.watch.manager import get_watch_config as get_watch_manager_config, DEFAULT_WATCH_CONFIG, CONFIG_FILE_PATH as WATCH_CONFIG_FILE_PATH

logger = logging.getLogger(__name__)

config_bp = Blueprint('config', __name__)

# Path to main config file (consistent with celery_config.py)
# CONFIG_PATH = Path('./data/config/main.json') # Defined as MAIN_CONFIG_FILE_PATH from import
# Path to watch config file (consistent with watch/manager.py)
# WATCH_CONFIG_PATH = Path('./data/config/watch.json') # Defined as WATCH_CONFIG_FILE_PATH from import

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

# Helper to get main config (uses the one from celery_config)
def get_config():
    """Retrieves the main configuration, creating it with defaults if necessary."""
    return get_main_config_params()

# Helper to save main config
def save_config(config_data):
    """Saves the main configuration data to main.json."""
    try:
        MAIN_CONFIG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
        # Ensure all default keys are present before saving, merging if necessary
        current_defaults = DEFAULT_MAIN_CONFIG.copy()
        # Overlay provided data on defaults to ensure all keys are there.
        # This might not be ideal if user explicitly wants to remove a key,
        # but for this setup, ensuring defaults is safer.
        # A better approach for full PUT might be to replace entirely,
        # but for ensuring defaults, this is okay.
        # Let's assume config_data is what the user intends fully.
        # We'll rely on get_config_params to have already populated defaults if the file was new.
        # When saving, we should just save what's given, after ensuring it has necessary structure.

        # Merge with defaults to ensure all keys are present
        # This ensures that if a user POSTs partial data, it's merged with existing/default structure
        
        # Load current or default config
        existing_config = {}
        if MAIN_CONFIG_FILE_PATH.exists():
            with open(MAIN_CONFIG_FILE_PATH, 'r') as f_read:
                existing_config = json.load(f_read)
        else: # Should be rare if get_config_params was called
            existing_config = DEFAULT_MAIN_CONFIG.copy()

        # Update with new data
        for key, value in config_data.items():
            existing_config[key] = value
        
        # Ensure all default keys are still there
        for default_key, default_value in DEFAULT_MAIN_CONFIG.items():
            if default_key not in existing_config:
                existing_config[default_key] = default_value
                
        with open(MAIN_CONFIG_FILE_PATH, 'w') as f:
            json.dump(existing_config, f, indent=4)
        logger.info(f"Main configuration saved to {MAIN_CONFIG_FILE_PATH}")
        return True, None
    except Exception as e:
        logger.error(f"Error saving main configuration: {e}", exc_info=True)
        return False, str(e)

# Helper to get watch config (uses the one from watch/manager.py)
def get_watch_config_http(): # Renamed to avoid conflict with the imported get_watch_config
    """Retrieves the watch configuration, creating it with defaults if necessary."""
    return get_watch_manager_config()

# Helper to save watch config
def save_watch_config_http(watch_config_data): # Renamed
    """Saves the watch configuration data to watch.json."""
    try:
        WATCH_CONFIG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
        
        # Similar logic to save_config: merge with defaults/existing
        existing_config = {}
        if WATCH_CONFIG_FILE_PATH.exists():
            with open(WATCH_CONFIG_FILE_PATH, 'r') as f_read:
                existing_config = json.load(f_read)
        else: # Should be rare if get_watch_manager_config was called
            existing_config = DEFAULT_WATCH_CONFIG.copy()

        for key, value in watch_config_data.items():
            existing_config[key] = value
            
        for default_key, default_value in DEFAULT_WATCH_CONFIG.items():
            if default_key not in existing_config:
                existing_config[default_key] = default_value

        with open(WATCH_CONFIG_FILE_PATH, 'w') as f:
            json.dump(existing_config, f, indent=4)
        logger.info(f"Watch configuration saved to {WATCH_CONFIG_FILE_PATH}")
        return True, None
    except Exception as e:
        logger.error(f"Error saving watch configuration: {e}", exc_info=True)
        return False, str(e)

@config_bp.route('/config', methods=['GET'])
def handle_config():
    """Handles GET requests for the main configuration."""
    try:
        config = get_config()
        return jsonify(config)
    except Exception as e:
        logger.error(f"Error in GET /config: {e}", exc_info=True)
        return jsonify({"error": "Failed to retrieve configuration", "details": str(e)}), 500

@config_bp.route('/config', methods=['POST', 'PUT'])
def update_config():
    """Handles POST/PUT requests to update the main configuration."""
    try:
        new_config = request.get_json()
        if not isinstance(new_config, dict):
            return jsonify({"error": "Invalid config format"}), 400

        # Get existing config to preserve environment-controlled values
        existing_config = get_config() or {}
        
        # Preserve the explicitFilter setting from environment
        explicit_filter_env = os.environ.get('EXPLICIT_FILTER', 'false').lower()
        new_config['explicitFilter'] = explicit_filter_env in ('true', '1', 'yes', 'on')

        success, error_msg = save_config(new_config)
        if success:
            # Return the updated config
            updated_config_values = get_config()
            if updated_config_values is None:
                # This case should ideally not be reached if save_config succeeded
                # and get_config handles errors by returning a default or None.
                return jsonify({"error": "Failed to retrieve configuration after saving"}), 500
            
            return jsonify(updated_config_values)
        else:
            return jsonify({"error": "Failed to update configuration", "details": error_msg}), 500
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON data"}), 400
    except Exception as e:
        logger.error(f"Error in POST/PUT /config: {e}", exc_info=True)
        return jsonify({"error": "Failed to update configuration", "details": str(e)}), 500

@config_bp.route('/config/check', methods=['GET'])
def check_config_changes():
    # This endpoint seems more related to dynamically checking if config changed
    # on disk, which might not be necessary if settings are applied on restart
    # or by a dedicated manager. For now, just return current config.
    try:
        config = get_config()
        return jsonify({
            "message": "Current configuration retrieved.",
            "config": config
        })
    except Exception as e:
        logger.error(f"Error in GET /config/check: {e}", exc_info=True)
        return jsonify({"error": "Failed to check configuration", "details": str(e)}), 500

@config_bp.route('/config/watch', methods=['GET'])
def handle_watch_config():
    """Handles GET requests for the watch configuration."""
    try:
        watch_config = get_watch_config_http()
        return jsonify(watch_config)
    except Exception as e:
        logger.error(f"Error in GET /config/watch: {e}", exc_info=True)
        return jsonify({"error": "Failed to retrieve watch configuration", "details": str(e)}), 500

@config_bp.route('/config/watch', methods=['POST', 'PUT'])
def update_watch_config():
    """Handles POST/PUT requests to update the watch configuration."""
    try:
        new_watch_config = request.get_json()
        if not isinstance(new_watch_config, dict):
            return jsonify({"error": "Invalid watch config format"}), 400

        success, error_msg = save_watch_config_http(new_watch_config)
        if success:
            return jsonify({"message": "Watch configuration updated successfully"}), 200
        else:
            return jsonify({"error": "Failed to update watch configuration", "details": error_msg}), 500
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON data for watch config"}), 400
    except Exception as e:
        logger.error(f"Error in POST/PUT /config/watch: {e}", exc_info=True)
        return jsonify({"error": "Failed to update watch configuration", "details": str(e)}), 500