from deezspot.easy_spoty import Spo
import json
from pathlib import Path
import logging

# Configure logger
logger = logging.getLogger(__name__)

def search(
    query: str, 
    search_type: str, 
    limit: int = 3,
    main: str = None
) -> dict:
    logger.info(f"Search requested: query='{query}', type={search_type}, limit={limit}, main={main}")
    
    # If main account is specified, load client ID and secret from the account's search.json
    client_id = None
    client_secret = None
    
    if main:
        search_creds_path = Path(f'./creds/spotify/{main}/search.json')
        logger.debug(f"Looking for credentials at: {search_creds_path}")
        
        if search_creds_path.exists():
            try:
                with open(search_creds_path, 'r') as f:
                    search_creds = json.load(f)
                    client_id = search_creds.get('client_id')
                    client_secret = search_creds.get('client_secret')
                logger.debug(f"Credentials loaded successfully for account: {main}")
            except Exception as e:
                logger.error(f"Error loading search credentials: {e}")
                print(f"Error loading search credentials: {e}")
        else:
            logger.warning(f"Credentials file not found at: {search_creds_path}")
    
    # Initialize the Spotify client with credentials (if available)
    if client_id and client_secret:
        logger.debug("Initializing Spotify client with account credentials")
        Spo.__init__(client_id, client_secret)
    else:
        logger.debug("Using default Spotify client credentials")
    
    # Perform the Spotify search
    logger.debug(f"Executing Spotify search with query='{query}', type={search_type}")
    try:
        spotify_response = Spo.search(
            query=query, 
            search_type=search_type, 
            limit=limit,
            client_id=client_id,
            client_secret=client_secret
        )
        logger.info(f"Search completed successfully")
        return spotify_response
    except Exception as e:
        logger.error(f"Error during Spotify search: {e}")
        raise
