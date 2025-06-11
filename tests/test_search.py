import requests
import pytest

def test_search_spotify_artist(base_url):
    """Tests searching for an artist on Spotify."""
    response = requests.get(f"{base_url}/search?q=Daft+Punk&search_type=artist")
    assert response.status_code == 200
    results = response.json()
    assert "items" in results
    assert len(results["items"]) > 0
    assert "Daft Punk" in results["items"][0]["name"]

def test_search_spotify_track(base_url):
    """Tests searching for a track on Spotify."""
    response = requests.get(f"{base_url}/search?q=Get+Lucky&search_type=track")
    assert response.status_code == 200
    results = response.json()
    assert "items" in results
    assert len(results["items"]) > 0

def test_search_deezer_track(base_url):
    """Tests searching for a track on Deezer."""
    response = requests.get(f"{base_url}/search?q=Instant+Crush&search_type=track")
    assert response.status_code == 200
    results = response.json()
    assert "items" in results
    assert len(results["items"]) > 0
    
def test_search_deezer_album(base_url):
    """Tests searching for an album on Deezer."""
    response = requests.get(f"{base_url}/search?q=Random+Access+Memories&search_type=album")
    assert response.status_code == 200
    results = response.json()
    assert "items" in results
    assert len(results["items"]) > 0 