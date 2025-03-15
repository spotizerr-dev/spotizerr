from deezspot.easy_spoty import Spo
import json
from pathlib import Path

def search(
    query: str, 
    search_type: str, 
    limit: int = 3,
    main: str = None
) -> dict:
    # If main account is specified, load client ID and secret from the account's search.json
    client_id = None
    client_secret = None
    
    if main:
        search_creds_path = Path(f'./creds/spotify/{main}/search.json')

        if search_creds_path.exists():
            try:
                with open(search_creds_path, 'r') as f:
                    search_creds = json.load(f)
                    client_id = search_creds.get('client_id')
                    client_secret = search_creds.get('client_secret')
            except Exception as e:
                print(f"Error loading search credentials: {e}")
    
    # Initialize the Spotify client with credentials (if available)
    if client_id and client_secret:
        Spo.__init__(client_id, client_secret)
    
    # Perform the Spotify search
    # Note: We don't need to pass client_id and client_secret again in the search method
    # as they've already been set during initialization
    spotify_response = Spo.search(
        query=query, 
        search_type=search_type, 
        limit=limit,
        client_id=client_id,
        client_secret=client_secret
    )
    
    return spotify_response
