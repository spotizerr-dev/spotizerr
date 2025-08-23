from fastapi import APIRouter, HTTPException, Request, Depends
import json
import logging
from routes.utils.credentials import (
    get_credential,
    list_credentials,
    create_credential,
    delete_credential,
    edit_credential,
    init_credentials_db,
    # Import new utility functions for global Spotify API creds
    _get_global_spotify_api_creds,
    save_global_spotify_api_creds,
)

# Import authentication dependencies
from routes.auth.middleware import require_auth_from_state, require_admin_from_state, User

logger = logging.getLogger(__name__)
router = APIRouter()

# Initialize the database and tables when the router is loaded
init_credentials_db()


def _set_active_account_if_empty(service: str, name: str):
    """
    Sets the newly created account as the active account in the main config
    if no active account is currently set for the given service.
    """
    try:
        from routes.utils.celery_config import get_config_params as get_main_config_params
        from routes.system.config import save_config
        config = get_main_config_params()
        if not config.get(service):
            config[service] = name
            save_config(config)
    except Exception as e:
        logger.warning(f"Could not set new {service.capitalize()} account '{name}' as active: {e}")


@router.get("/spotify_api_config")
@router.put("/spotify_api_config")
async def handle_spotify_api_config(request: Request, current_user: User = Depends(require_admin_from_state)):
    """Handles GET and PUT requests for the global Spotify API client_id and client_secret."""
    try:
        if request.method == "GET":
            client_id, client_secret = _get_global_spotify_api_creds()
            if client_id is not None and client_secret is not None:
                return {"client_id": client_id, "client_secret": client_secret}
            else:
                # If search.json exists but is empty/incomplete, or doesn't exist
                return {
                    "warning": "Global Spotify API credentials are not fully configured or file is missing.",
                    "client_id": client_id or "",
                    "client_secret": client_secret or "",
                }

        elif request.method == "PUT":
            data = await request.json()
            if not data or "client_id" not in data or "client_secret" not in data:
                raise HTTPException(
                    status_code=400,
                    detail={"error": "Request body must contain 'client_id' and 'client_secret'"}
                )

            client_id = data["client_id"]
            client_secret = data["client_secret"]

            if not isinstance(client_id, str) or not isinstance(client_secret, str):
                raise HTTPException(
                    status_code=400,
                    detail={"error": "'client_id' and 'client_secret' must be strings"}
                )

            if save_global_spotify_api_creds(client_id, client_secret):
                return {"message": "Global Spotify API credentials updated successfully."}
            else:
                raise HTTPException(
                    status_code=500,
                    detail={"error": "Failed to save global Spotify API credentials."}
                )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in /spotify_api_config: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": f"An unexpected error occurred: {str(e)}"})


@router.get("/{service}")
async def handle_list_credentials(service: str, current_user: User = Depends(require_admin_from_state)):
    try:
        if service not in ["spotify", "deezer"]:
            raise HTTPException(
                status_code=400,
                detail={"error": "Invalid service. Must be 'spotify' or 'deezer'"}
            )
        return list_credentials(service)
    except ValueError as e:  # Should not happen with service check above
        raise HTTPException(status_code=400, detail={"error": str(e)})
    except Exception as e:
        logger.error(f"Error listing credentials for {service}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": f"An unexpected error occurred: {str(e)}"})


@router.get("/{service}/{name}")
async def handle_get_credential(service: str, name: str, current_user: User = Depends(require_admin_from_state)):
    try:
        if service not in ["spotify", "deezer"]:
            raise HTTPException(
                status_code=400,
                detail={"error": "Invalid service. Must be 'spotify' or 'deezer'"}
            )

        # get_credential for Spotify now only returns region and blob_file_path
        return get_credential(service, name)
    except (ValueError, FileNotFoundError, FileExistsError) as e:
        status_code = 400
        if isinstance(e, FileNotFoundError):
            status_code = 404
        elif isinstance(e, FileExistsError):
            status_code = 409
        logger.warning(f"Client error in /{service}/{name}: {str(e)}")
        raise HTTPException(status_code=status_code, detail={"error": str(e)})
    except Exception as e:
        logger.error(f"Server error in /{service}/{name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": f"An unexpected error occurred: {str(e)}"})


@router.post("/{service}/{name}")
async def handle_create_credential(service: str, name: str, request: Request, current_user: User = Depends(require_admin_from_state)):
    try:
        if service not in ["spotify", "deezer"]:
            raise HTTPException(
                status_code=400,
                detail={"error": "Invalid service. Must be 'spotify' or 'deezer'"}
            )

        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail={"error": "Request body cannot be empty."})
        
        # create_credential for Spotify now expects 'region' and 'blob_content'
        # For Deezer, it expects 'arl' and 'region'
        # Validation is handled within create_credential utility function
        result = create_credential(service, name, data)

        _set_active_account_if_empty(service, name)

        return {
            "message": f"Credential for '{name}' ({service}) created successfully.",
            "details": result,
        }
    except (ValueError, FileNotFoundError, FileExistsError) as e:
        status_code = 400
        if isinstance(e, FileNotFoundError):
            status_code = 404
        elif isinstance(e, FileExistsError):
            status_code = 409
        logger.warning(f"Client error in /{service}/{name}: {str(e)}")
        raise HTTPException(status_code=status_code, detail={"error": str(e)})
    except Exception as e:
        logger.error(f"Server error in /{service}/{name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": f"An unexpected error occurred: {str(e)}"})


@router.put("/{service}/{name}")
async def handle_update_credential(service: str, name: str, request: Request, current_user: User = Depends(require_admin_from_state)):
    try:
        if service not in ["spotify", "deezer"]:
            raise HTTPException(
                status_code=400,
                detail={"error": "Invalid service. Must be 'spotify' or 'deezer'"}
            )

        data = await request.json()
        if not data:
            raise HTTPException(status_code=400, detail={"error": "Request body cannot be empty."})
        
        # edit_credential for Spotify now handles updates to 'region', 'blob_content'
        # For Deezer, 'arl', 'region'
        result = edit_credential(service, name, data)
        return {
            "message": f"Credential for '{name}' ({service}) updated successfully.",
            "details": result,
        }
    except (ValueError, FileNotFoundError, FileExistsError) as e:
        status_code = 400
        if isinstance(e, FileNotFoundError):
            status_code = 404
        elif isinstance(e, FileExistsError):
            status_code = 409
        logger.warning(f"Client error in /{service}/{name}: {str(e)}")
        raise HTTPException(status_code=status_code, detail={"error": str(e)})
    except Exception as e:
        logger.error(f"Server error in /{service}/{name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": f"An unexpected error occurred: {str(e)}"})


@router.delete("/{service}/{name}")
async def handle_delete_credential(service: str, name: str, current_user: User = Depends(require_admin_from_state)):
    try:
        if service not in ["spotify", "deezer"]:
            raise HTTPException(
                status_code=400,
                detail={"error": "Invalid service. Must be 'spotify' or 'deezer'"}
            )

        # delete_credential for Spotify also handles deleting the blob directory
        result = delete_credential(service, name)
        return {
            "message": f"Credential for '{name}' ({service}) deleted successfully.",
            "details": result,
        }
    except (ValueError, FileNotFoundError, FileExistsError) as e:
        status_code = 400
        if isinstance(e, FileNotFoundError):
            status_code = 404
        elif isinstance(e, FileExistsError):
            status_code = 409
        logger.warning(f"Client error in /{service}/{name}: {str(e)}")
        raise HTTPException(status_code=status_code, detail={"error": str(e)})
    except Exception as e:
        logger.error(f"Server error in /{service}/{name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": f"An unexpected error occurred: {str(e)}"})


# The '/search/<service>/<name>' route is now obsolete for Spotify and has been removed.


@router.get("/all/{service}")
async def handle_all_credentials(service: str, current_user: User = Depends(require_admin_from_state)):
    """Lists all credentials for a given service. For Spotify, API keys are global and not listed per account."""
    try:
        if service not in ["spotify", "deezer"]:
            raise HTTPException(
                status_code=400,
                detail={"error": "Invalid service. Must be 'spotify' or 'deezer'"}
            )

        credentials_list = []
        account_names = list_credentials(service)  # This lists names from DB

        for name in account_names:
            try:
                # get_credential for Spotify returns region and blob_file_path.
                # For Deezer, it returns arl and region.
                account_data = get_credential(service, name)
                # We don't add global Spotify API keys here as they are separate
                credentials_list.append({"name": name, "details": account_data})
            except FileNotFoundError:
                logger.warning(
                    f"Credential name '{name}' listed for service '{service}' but not found by get_credential. Skipping."
                )
            except Exception as e_inner:
                logger.error(
                    f"Error fetching details for credential '{name}' ({service}): {e_inner}",
                    exc_info=True,
                )
                credentials_list.append(
                    {
                        "name": name,
                        "error": f"Could not retrieve details: {str(e_inner)}",
                    }
                )

        return credentials_list
    except Exception as e:
        logger.error(f"Error in /all/{service}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": f"An unexpected error occurred: {str(e)}"})


@router.get("/markets")
async def handle_markets(current_user: User = Depends(require_admin_from_state)):
    """
    Returns a list of unique market regions for Deezer and Spotify accounts.
    """
    try:
        deezer_regions = set()
        spotify_regions = set()

        # Process Deezer accounts
        deezer_account_names = list_credentials("deezer")
        for name in deezer_account_names:
            try:
                account_data = get_credential("deezer", name)
                if account_data and "region" in account_data and account_data["region"]:
                    deezer_regions.add(account_data["region"])
            except Exception as e:
                logger.warning(
                    f"Could not retrieve region for deezer account {name}: {e}"
                )

        # Process Spotify accounts
        spotify_account_names = list_credentials("spotify")
        for name in spotify_account_names:
            try:
                account_data = get_credential("spotify", name)
                if account_data and "region" in account_data and account_data["region"]:
                    spotify_regions.add(account_data["region"])
            except Exception as e:
                logger.warning(
                    f"Could not retrieve region for spotify account {name}: {e}"
                )

        return {
            "deezer": sorted(list(deezer_regions)),
            "spotify": sorted(list(spotify_regions)),
        }

    except Exception as e:
        logger.error(f"Error in /markets: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": f"An unexpected error occurred: {str(e)}"})
