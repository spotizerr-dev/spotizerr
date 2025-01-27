from deezspot.easy_spoty import Spo

def search(
    query: str, 
    search_type: str, 
    limit: int = 3
) -> dict:
    # Initialize the Spotify client
    Spo.__init__()
    
    # Perform the Spotify search and return the raw response
    spotify_response = Spo.search(query=query, search_type=search_type, limit=limit)
    return spotify_response
