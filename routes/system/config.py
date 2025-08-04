from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import JSONResponse
import json
import logging
import os
from typing import Any
from pathlib import Path

# Import the centralized config getters that handle file creation and defaults
from routes.utils.celery_config import (
    get_config_params as get_main_config_params,
    DEFAULT_MAIN_CONFIG,
    CONFIG_FILE_PATH as MAIN_CONFIG_FILE_PATH,
)
from routes.utils.watch.manager import (
    get_watch_config as get_watch_manager_config,
    DEFAULT_WATCH_CONFIG,
    CONFIG_FILE_PATH as WATCH_CONFIG_FILE_PATH,
)

# Import authentication dependencies
from routes.auth.middleware import require_admin_from_state, User

logger = logging.getLogger(__name__)

router = APIRouter()


# Flag for config change notifications
config_changed = False
last_config: dict[str, Any] = {}

# Define parameters that should trigger notification when changed
NOTIFY_PARAMETERS = [
    "maxConcurrentDownloads",
    "service",
    "fallback",
    "spotifyQuality",
    "deezerQuality",
]


# Helper function to check if credentials exist for a service
def has_credentials(service: str) -> bool:
    """Check if credentials exist for the specified service (spotify or deezer)."""
    try:
        credentials_path = Path(f"./data/credentials/{service}")
        if not credentials_path.exists():
            return False
        
        # Check if there are any credential files in the directory
        credential_files = list(credentials_path.glob("*.json"))
        return len(credential_files) > 0
    except Exception as e:
        logger.warning(f"Error checking credentials for {service}: {e}")
        return False


# Validation function for configuration consistency
def validate_config(config_data: dict, watch_config: dict = None) -> tuple[bool, str]:
    """
    Validate configuration for consistency and requirements.
    Returns (is_valid, error_message).
    """
    try:
        # Get current watch config if not provided
        if watch_config is None:
            watch_config = get_watch_config_http()
        
        # Check if fallback is enabled but missing required accounts
        if config_data.get("fallback", False):
            has_spotify = has_credentials("spotify")
            has_deezer = has_credentials("deezer")
            
            if not has_spotify or not has_deezer:
                missing_services = []
                if not has_spotify:
                    missing_services.append("Spotify")
                if not has_deezer:
                    missing_services.append("Deezer")
                
                return False, f"Download Fallback requires accounts to be configured for both services. Missing: {', '.join(missing_services)}. Configure accounts before enabling fallback."
        
        # Check if watch is enabled but no download methods are available
        if watch_config.get("enabled", False):
            real_time = config_data.get("realTime", False)
            fallback = config_data.get("fallback", False)
            
            if not real_time and not fallback:
                return False, "Watch functionality requires either Real-time downloading or Download Fallback to be enabled."
        
        return True, ""
        
    except Exception as e:
        logger.error(f"Error validating configuration: {e}", exc_info=True)
        return False, f"Configuration validation error: {str(e)}"


def validate_watch_config(watch_data: dict, main_config: dict = None) -> tuple[bool, str]:
    """
    Validate watch configuration for consistency and requirements.
    Returns (is_valid, error_message).
    """
    try:
        # Get current main config if not provided
        if main_config is None:
            main_config = get_config()
        
        # Check if trying to enable watch without download methods
        if watch_data.get("enabled", False):
            real_time = main_config.get("realTime", False)
            fallback = main_config.get("fallback", False)
            
            if not real_time and not fallback:
                return False, "Cannot enable watch: either Real-time downloading or Download Fallback must be enabled in download settings."
            
            # If fallback is enabled, check for required accounts
            if fallback:
                has_spotify = has_credentials("spotify")
                has_deezer = has_credentials("deezer")
                
                if not has_spotify or not has_deezer:
                    missing_services = []
                    if not has_spotify:
                        missing_services.append("Spotify")
                    if not has_deezer:
                        missing_services.append("Deezer")
                    
                    return False, f"Cannot enable watch with fallback: missing accounts for {', '.join(missing_services)}. Configure accounts before enabling watch."
        
        return True, ""
        
    except Exception as e:
        logger.error(f"Error validating watch configuration: {e}", exc_info=True)
        return False, f"Watch configuration validation error: {str(e)}"


# Helper to get main config (uses the one from celery_config)
def get_config():
    """Retrieves the main configuration, creating it with defaults if necessary."""
    return get_main_config_params()


# Helper to save main config
def save_config(config_data):
    """Saves the main configuration data to main.json."""
    try:
        MAIN_CONFIG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
        # Load current or default config
        existing_config = {}
        if MAIN_CONFIG_FILE_PATH.exists():
            with open(MAIN_CONFIG_FILE_PATH, "r") as f_read:
                existing_config = json.load(f_read)
        else:  # Should be rare if get_config_params was called
            existing_config = DEFAULT_MAIN_CONFIG.copy()

        # Update with new data
        for key, value in config_data.items():
            existing_config[key] = value

        # Ensure all default keys are still there
        for default_key, default_value in DEFAULT_MAIN_CONFIG.items():
            if default_key not in existing_config:
                existing_config[default_key] = default_value

        with open(MAIN_CONFIG_FILE_PATH, "w") as f:
            json.dump(existing_config, f, indent=4)
        logger.info(f"Main configuration saved to {MAIN_CONFIG_FILE_PATH}")
        return True, None
    except Exception as e:
        logger.error(f"Error saving main configuration: {e}", exc_info=True)
        return False, str(e)


# Helper to get watch config (uses the one from watch/manager.py)
def get_watch_config_http():  # Renamed to avoid conflict with the imported get_watch_config
    """Retrieves the watch configuration, creating it with defaults if necessary."""
    return get_watch_manager_config()


# Helper to save watch config
def save_watch_config_http(watch_config_data):  # Renamed
    """Saves the watch configuration data to watch.json."""
    try:
        WATCH_CONFIG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)

        # Similar logic to save_config: merge with defaults/existing
        existing_config = {}
        if WATCH_CONFIG_FILE_PATH.exists():
            with open(WATCH_CONFIG_FILE_PATH, "r") as f_read:
                existing_config = json.load(f_read)
        else:  # Should be rare if get_watch_manager_config was called
            existing_config = DEFAULT_WATCH_CONFIG.copy()

        for key, value in watch_config_data.items():
            existing_config[key] = value

        for default_key, default_value in DEFAULT_WATCH_CONFIG.items():
            if default_key not in existing_config:
                existing_config[default_key] = default_value

        with open(WATCH_CONFIG_FILE_PATH, "w") as f:
            json.dump(existing_config, f, indent=4)
        logger.info(f"Watch configuration saved to {WATCH_CONFIG_FILE_PATH}")
        return True, None
    except Exception as e:
        logger.error(f"Error saving watch configuration: {e}", exc_info=True)
        return False, str(e)


@router.get("/config")
async def handle_config(current_user: User = Depends(require_admin_from_state)):
    """Handles GET requests for the main configuration."""
    try:
        config = get_config()
        return config
    except Exception as e:
        logger.error(f"Error in GET /config: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "Failed to retrieve configuration", "details": str(e)}
        )


@router.post("/config")
@router.put("/config")
async def update_config(request: Request, current_user: User = Depends(require_admin_from_state)):
    """Handles POST/PUT requests to update the main configuration."""
    try:
        new_config = await request.json()
        if not isinstance(new_config, dict):
            raise HTTPException(status_code=400, detail={"error": "Invalid config format"})

        # Preserve the explicitFilter setting from environment
        explicit_filter_env = os.environ.get("EXPLICIT_FILTER", "false").lower()
        new_config["explicitFilter"] = explicit_filter_env in ("true", "1", "yes", "on")

        # Validate configuration before saving
        is_valid, error_message = validate_config(new_config)
        if not is_valid:
            raise HTTPException(
                status_code=400,
                detail={"error": "Configuration validation failed", "details": error_message}
            )

        success, error_msg = save_config(new_config)
        if success:
            # Return the updated config
            updated_config_values = get_config()
            if updated_config_values is None:
                # This case should ideally not be reached if save_config succeeded
                # and get_config handles errors by returning a default or None.
                raise HTTPException(
                    status_code=500,
                    detail={"error": "Failed to retrieve configuration after saving"}
                )

            return updated_config_values
        else:
            raise HTTPException(
                status_code=500,
                detail={"error": "Failed to update configuration", "details": error_msg}
            )
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail={"error": "Invalid JSON data"})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in POST/PUT /config: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "Failed to update configuration", "details": str(e)}
        )


@router.get("/config/check")
async def check_config_changes(current_user: User = Depends(require_admin_from_state)):
    # This endpoint seems more related to dynamically checking if config changed
    # on disk, which might not be necessary if settings are applied on restart
    # or by a dedicated manager. For now, just return current config.
    try:
        config = get_config()
        return {"message": "Current configuration retrieved.", "config": config}
    except Exception as e:
        logger.error(f"Error in GET /config/check: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "Failed to check configuration", "details": str(e)}
        )


@router.post("/config/validate")
async def validate_config_endpoint(request: Request, current_user: User = Depends(require_admin_from_state)):
    """Validate configuration without saving it."""
    try:
        config_data = await request.json()
        if not isinstance(config_data, dict):
            raise HTTPException(status_code=400, detail={"error": "Invalid config format"})

        is_valid, error_message = validate_config(config_data)
        
        return {
            "valid": is_valid,
            "message": "Configuration is valid" if is_valid else error_message,
            "details": error_message if not is_valid else None
        }
        
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail={"error": "Invalid JSON data"})
    except Exception as e:
        logger.error(f"Error in POST /config/validate: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "Failed to validate configuration", "details": str(e)}
        )


@router.post("/config/watch/validate")
async def validate_watch_config_endpoint(request: Request, current_user: User = Depends(require_admin_from_state)):
    """Validate watch configuration without saving it."""
    try:
        watch_data = await request.json()
        if not isinstance(watch_data, dict):
            raise HTTPException(status_code=400, detail={"error": "Invalid watch config format"})

        is_valid, error_message = validate_watch_config(watch_data)
        
        return {
            "valid": is_valid,
            "message": "Watch configuration is valid" if is_valid else error_message,
            "details": error_message if not is_valid else None
        }
        
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail={"error": "Invalid JSON data"})
    except Exception as e:
        logger.error(f"Error in POST /config/watch/validate: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "Failed to validate watch configuration", "details": str(e)}
        )


@router.get("/config/watch")
async def handle_watch_config(current_user: User = Depends(require_admin_from_state)):
    """Handles GET requests for the watch configuration."""
    try:
        watch_config = get_watch_config_http()
        return watch_config
    except Exception as e:
        logger.error(f"Error in GET /config/watch: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "Failed to retrieve watch configuration", "details": str(e)}
        )


@router.post("/config/watch")
@router.put("/config/watch")
async def update_watch_config(request: Request, current_user: User = Depends(require_admin_from_state)):
    """Handles POST/PUT requests to update the watch configuration."""
    try:
        new_watch_config = await request.json()
        if not isinstance(new_watch_config, dict):
            raise HTTPException(status_code=400, detail={"error": "Invalid watch config format"})

        # Validate watch configuration before saving
        is_valid, error_message = validate_watch_config(new_watch_config)
        if not is_valid:
            raise HTTPException(
                status_code=400,
                detail={"error": "Watch configuration validation failed", "details": error_message}
            )

        success, error_msg = save_watch_config_http(new_watch_config)
        if success:
            return {"message": "Watch configuration updated successfully"}
        else:
            raise HTTPException(
                status_code=500,
                detail={"error": "Failed to update watch configuration", "details": error_msg}
            )
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail={"error": "Invalid JSON data for watch config"})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in POST/PUT /config/watch: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "Failed to update watch configuration", "details": str(e)}
        )
