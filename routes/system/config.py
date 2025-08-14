from fastapi import APIRouter, HTTPException, Request, Depends
import json
import logging
import os
from typing import Any

# Import the centralized config getters that handle file creation and defaults
from routes.utils.celery_config import (
    get_config_params as get_main_config_params,
    DEFAULT_MAIN_CONFIG,
    CONFIG_FILE_PATH as MAIN_CONFIG_FILE_PATH,
)
from routes.utils.watch.manager import (
    get_watch_config as get_watch_manager_config,
    DEFAULT_WATCH_CONFIG,
    MAIN_CONFIG_FILE_PATH as WATCH_MAIN_CONFIG_FILE_PATH,
)

# Import authentication dependencies
from routes.auth.middleware import require_admin_from_state, User

# Import credential utilities (DB-backed)
from routes.utils.credentials import list_credentials, _get_global_spotify_api_creds

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
        if service not in ("spotify", "deezer"):
            return False

        account_names = list_credentials(service)
        has_any_accounts = bool(account_names)

        if service == "spotify":
            client_id, client_secret = _get_global_spotify_api_creds()
            has_global_api_creds = bool(client_id) and bool(client_secret)
            return has_any_accounts and has_global_api_creds

        return has_any_accounts
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

                return (
                    False,
                    f"Download Fallback requires accounts to be configured for both services. Missing: {', '.join(missing_services)}. Configure accounts before enabling fallback.",
                )

        # Check if watch is enabled but no download methods are available
        if watch_config.get("enabled", False):
            real_time = config_data.get("realTime", False)
            fallback = config_data.get("fallback", False)

            if not real_time and not fallback:
                return (
                    False,
                    "Watch functionality requires either Real-time downloading or Download Fallback to be enabled.",
                )

        return True, ""

    except Exception as e:
        logger.error(f"Error validating configuration: {e}", exc_info=True)
        return False, f"Configuration validation error: {str(e)}"


def validate_watch_config(
    watch_data: dict, main_config: dict = None
) -> tuple[bool, str]:
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
                return (
                    False,
                    "Cannot enable watch: either Real-time downloading or Download Fallback must be enabled in download settings.",
                )

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

                    return (
                        False,
                        f"Cannot enable watch with fallback: missing accounts for {', '.join(missing_services)}. Configure accounts before enabling watch.",
                    )

        return True, ""

    except Exception as e:
        logger.error(f"Error validating watch configuration: {e}", exc_info=True)
        return False, f"Watch configuration validation error: {str(e)}"


# Helper to get main config (uses the one from celery_config)
def get_config():
    """Retrieves the main configuration, creating it with defaults if necessary."""
    return get_main_config_params()


def _migrate_legacy_keys_inplace(cfg: dict) -> bool:
    """Migrate legacy snake_case keys in the main config to camelCase. Returns True if modified."""
    legacy_map = {
        "tracknum_padding": "tracknumPadding",
        "save_cover": "saveCover",
        "retry_delay_increase": "retryDelayIncrease",
        "artist_separator": "artistSeparator",
        "recursive_quality": "recursiveQuality",
        "spotify_metadata": "spotifyMetadata",
    }
    modified = False
    for legacy, camel in legacy_map.items():
        if legacy in cfg and camel not in cfg:
            cfg[camel] = cfg.pop(legacy)
            modified = True
    # Ensure watch block exists and migrate inside watch defaults handled in manager.get_watch_config
    if "watch" not in cfg or not isinstance(cfg.get("watch"), dict):
        cfg["watch"] = DEFAULT_WATCH_CONFIG.copy()
        modified = True
    return modified


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

        # Migration: unify legacy keys to camelCase
        if _migrate_legacy_keys_inplace(existing_config):
            logger.info("Migrated legacy config keys to camelCase.")

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


def get_watch_config_http():
    """Retrieves the watch configuration from main.json watch key."""
    return get_watch_manager_config()


def save_watch_config_http(watch_config_data):
    """Saves the watch configuration data to the 'watch' key in main.json."""
    try:
        WATCH_MAIN_CONFIG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
        if WATCH_MAIN_CONFIG_FILE_PATH.exists():
            with open(WATCH_MAIN_CONFIG_FILE_PATH, "r") as f:
                main_cfg = json.load(f) or {}
        else:
            main_cfg = DEFAULT_MAIN_CONFIG.copy()
        current_watch = (main_cfg.get("watch") or {}).copy()
        current_watch.update(watch_config_data or {})
        # Ensure defaults
        for k, v in DEFAULT_WATCH_CONFIG.items():
            if k not in current_watch:
                current_watch[k] = v
        main_cfg["watch"] = current_watch
        # Migrate legacy main keys as well
        _migrate_legacy_keys_inplace(main_cfg)
        with open(WATCH_MAIN_CONFIG_FILE_PATH, "w") as f:
            json.dump(main_cfg, f, indent=4)
        logger.info("Watch configuration updated in main.json under 'watch'.")
        return True, None
    except Exception as e:
        logger.error(
            f"Error saving watch configuration to main.json: {e}", exc_info=True
        )
        return False, str(e)


@router.get("/")
@router.get("")
async def handle_config(current_user: User = Depends(require_admin_from_state)):
    """Handles GET requests for the main configuration."""
    try:
        config = get_config()
        return config
    except Exception as e:
        logger.error(f"Error in GET /config: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "Failed to retrieve configuration", "details": str(e)},
        )


@router.post("/")
@router.put("/")
@router.post("")
@router.put("")
async def update_config(
    request: Request, current_user: User = Depends(require_admin_from_state)
):
    """Handles POST/PUT requests to update the main configuration."""
    try:
        new_config = await request.json()
        if not isinstance(new_config, dict):
            raise HTTPException(
                status_code=400, detail={"error": "Invalid config format"}
            )

        # Preserve the explicitFilter setting from environment
        explicit_filter_env = os.environ.get("EXPLICIT_FILTER", "false").lower()
        new_config["explicitFilter"] = explicit_filter_env in ("true", "1", "yes", "on")

        # Validate configuration before saving
        is_valid, error_message = validate_config(new_config)
        if not is_valid:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "Configuration validation failed",
                    "details": error_message,
                },
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
                    detail={"error": "Failed to retrieve configuration after saving"},
                )

            return updated_config_values
        else:
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "Failed to update configuration",
                    "details": error_msg,
                },
            )
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail={"error": "Invalid JSON data"})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in POST/PUT /config: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "Failed to update configuration", "details": str(e)},
        )


@router.get("/check")
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
            detail={"error": "Failed to check configuration", "details": str(e)},
        )


@router.post("/validate")
async def validate_config_endpoint(
    request: Request, current_user: User = Depends(require_admin_from_state)
):
    """Validate configuration without saving it."""
    try:
        config_data = await request.json()
        if not isinstance(config_data, dict):
            raise HTTPException(
                status_code=400, detail={"error": "Invalid config format"}
            )

        is_valid, error_message = validate_config(config_data)

        return {
            "valid": is_valid,
            "message": "Configuration is valid" if is_valid else error_message,
            "details": error_message if not is_valid else None,
        }

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail={"error": "Invalid JSON data"})
    except Exception as e:
        logger.error(f"Error in POST /config/validate: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "Failed to validate configuration", "details": str(e)},
        )


@router.post("/watch/validate")
async def validate_watch_config_endpoint(
    request: Request, current_user: User = Depends(require_admin_from_state)
):
    """Validate watch configuration without saving it."""
    try:
        watch_data = await request.json()
        if not isinstance(watch_data, dict):
            raise HTTPException(
                status_code=400, detail={"error": "Invalid watch config format"}
            )

        is_valid, error_message = validate_watch_config(watch_data)

        return {
            "valid": is_valid,
            "message": "Watch configuration is valid" if is_valid else error_message,
            "details": error_message if not is_valid else None,
        }

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail={"error": "Invalid JSON data"})
    except Exception as e:
        logger.error(f"Error in POST /config/watch/validate: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Failed to validate watch configuration",
                "details": str(e),
            },
        )


@router.get("/watch")
async def handle_watch_config(current_user: User = Depends(require_admin_from_state)):
    """Handles GET requests for the watch configuration."""
    try:
        watch_config = get_watch_config_http()
        return watch_config
    except Exception as e:
        logger.error(f"Error in GET /config/watch: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Failed to retrieve watch configuration",
                "details": str(e),
            },
        )


@router.post("/watch")
@router.put("/watch")
async def update_watch_config(
    request: Request, current_user: User = Depends(require_admin_from_state)
):
    """Handles POST/PUT requests to update the watch configuration."""
    try:
        new_watch_config = await request.json()
        if not isinstance(new_watch_config, dict):
            raise HTTPException(
                status_code=400, detail={"error": "Invalid watch config format"}
            )

        # Validate watch configuration before saving
        is_valid, error_message = validate_watch_config(new_watch_config)
        if not is_valid:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "Watch configuration validation failed",
                    "details": error_message,
                },
            )

        success, error_msg = save_watch_config_http(new_watch_config)
        if success:
            return {"message": "Watch configuration updated successfully"}
        else:
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "Failed to update watch configuration",
                    "details": error_msg,
                },
            )
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=400, detail={"error": "Invalid JSON data for watch config"}
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in POST/PUT /config/watch: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "Failed to update watch configuration", "details": str(e)},
        )
