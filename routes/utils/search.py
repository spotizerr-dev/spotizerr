import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
import logging
from routes.utils.credentials import get_credential, _get_global_spotify_api_creds
import time

# Configure logger
logger = logging.getLogger(__name__)

# Global Spotify client instance for reuse (same pattern as get_info.py)
_spotify_client = None
_last_client_init = 0
_client_init_interval = 3600  # Reinitialize client every hour

def _get_spotify_client():
    """
    Get or create a Spotify client with global credentials.
    Implements client reuse and periodic reinitialization.
    """
    global _spotify_client, _last_client_init
    
    current_time = time.time()
    
    # Reinitialize client if it's been more than an hour or if client doesn't exist
    if (_spotify_client is None or 
        current_time - _last_client_init > _client_init_interval):
        
        client_id, client_secret = _get_global_spotify_api_creds()
        
        if not client_id or not client_secret:
            raise ValueError(
                "Global Spotify API client_id or client_secret not configured in ./data/creds/search.json."
            )
        
        # Create new client
        _spotify_client = spotipy.Spotify(
            client_credentials_manager=SpotifyClientCredentials(
                client_id=client_id,
                client_secret=client_secret
            )
        )
        _last_client_init = current_time
        logger.info("Spotify client initialized/reinitialized for search")
    
    return _spotify_client

def search(query: str, search_type: str, limit: int = 3, main: str = None) -> dict:
    logger.info(
        f"Search requested: query='{query}', type={search_type}, limit={limit}, main_account_name={main}"
        )

    if main:
        logger.debug(
            f"Spotify account context '{main}' was provided for search. API keys are global, but this account might be used for other context."
        )
        try:
            get_credential("spotify", main)
            logger.debug(f"Spotify account '{main}' exists.")
        except FileNotFoundError:
            logger.warning(
                f"Spotify account '{main}' provided for search context not found in credentials. Search will proceed with global API keys."
            )
        except Exception as e:
            logger.warning(
                f"Error checking existence of Spotify account '{main}': {e}. Search will proceed with global API keys."
            )
    else:
        logger.debug(
            "No specific 'main' account context provided for search. Using global API keys."
        )

    logger.debug("Getting Spotify client for search.")
    client = _get_spotify_client()

    logger.debug(
        f"Executing Spotify search with query='{query}', type={search_type}, limit={limit}"
    )
    try:
        # Map search types to Spotipy search types
        search_type_map = {
            'track': 'track',
            'album': 'album', 
            'artist': 'artist',
            'playlist': 'playlist',
            'episode': 'episode',
            'show': 'show'
        }
        
        spotify_type = search_type_map.get(search_type.lower(), 'track')
        
        # Execute search using Spotipy
        spotify_response = client.search(
            q=query,
            type=spotify_type,
            limit=limit
        )
        
        logger.info(f"Search completed successfully for query: '{query}'")
        return spotify_response
    except Exception as e:
        logger.error(
            f"Error during Spotify search for query '{query}': {e}", exc_info=True
        )
        raise
