import requests
import pytest
import time

SPOTIFY_PLAYLIST_ID = "26CiMxIxdn5WhXyccMCPOB"
SPOTIFY_ARTIST_ID = "7l6cdPhOLYO7lehz5xfzLV"

@pytest.fixture(autouse=True)
def setup_and_cleanup_watch_tests(base_url):
    """
    A fixture that enables watch mode, cleans the watchlist before each test,
    and then restores original state and cleans up after each test.
    """
    # Get original watch config to restore it later
    response = requests.get(f"{base_url}/config/watch")
    assert response.status_code == 200
    original_config = response.json()

    # Enable watch mode for testing if it's not already
    if not original_config.get("enabled"):
        response = requests.post(f"{base_url}/config/watch", json={"enabled": True})
        assert response.status_code == 200

    # Cleanup any existing watched items before the test
    requests.delete(f"{base_url}/playlist/watch/{SPOTIFY_PLAYLIST_ID}")
    requests.delete(f"{base_url}/artist/watch/{SPOTIFY_ARTIST_ID}")
    
    yield
    
    # Cleanup watched items created during the test
    requests.delete(f"{base_url}/playlist/watch/{SPOTIFY_PLAYLIST_ID}")
    requests.delete(f"{base_url}/artist/watch/{SPOTIFY_ARTIST_ID}")
    
    # Restore original watch config
    response = requests.post(f"{base_url}/config/watch", json=original_config)
    assert response.status_code == 200

def test_add_and_list_playlist_to_watch(base_url):
    """Tests adding a playlist to the watch list and verifying it appears in the list."""
    response = requests.put(f"{base_url}/playlist/watch/{SPOTIFY_PLAYLIST_ID}")
    assert response.status_code == 200
    assert "Playlist added to watch list" in response.json()["message"]

    # Verify it's in the watched list
    response = requests.get(f"{base_url}/playlist/watch/list")
    assert response.status_code == 200
    watched_playlists = response.json()
    assert any(p['spotify_id'] == SPOTIFY_PLAYLIST_ID for p in watched_playlists)

def test_add_and_list_artist_to_watch(base_url):
    """Tests adding an artist to the watch list and verifying it appears in the list."""
    response = requests.put(f"{base_url}/artist/watch/{SPOTIFY_ARTIST_ID}")
    assert response.status_code == 200
    assert "Artist added to watch list" in response.json()["message"]

    # Verify it's in the watched list
    response = requests.get(f"{base_url}/artist/watch/list")
    assert response.status_code == 200
    watched_artists = response.json()
    assert any(a['spotify_id'] == SPOTIFY_ARTIST_ID for a in watched_artists)

def test_trigger_playlist_check(base_url):
    """Tests the endpoint for manually triggering a check on a watched playlist."""
    # First, add the playlist to the watch list
    requests.put(f"{base_url}/playlist/watch/{SPOTIFY_PLAYLIST_ID}")
    
    # Trigger the check
    response = requests.post(f"{base_url}/playlist/watch/trigger_check/{SPOTIFY_PLAYLIST_ID}")
    assert response.status_code == 200
    assert "Check triggered for playlist" in response.json()["message"]
    
    # A full verification would require inspecting the database or new tasks,
    # but for an API test, confirming the trigger endpoint responds correctly is the key goal.
    print("Playlist check triggered. Note: This does not verify new downloads were queued.")

def test_trigger_artist_check(base_url):
    """Tests the endpoint for manually triggering a check on a watched artist."""
    # First, add the artist to the watch list
    requests.put(f"{base_url}/artist/watch/{SPOTIFY_ARTIST_ID}")

    # Trigger the check
    response = requests.post(f"{base_url}/artist/watch/trigger_check/{SPOTIFY_ARTIST_ID}")
    assert response.status_code == 200
    assert "Check triggered for artist" in response.json()["message"]
    print("Artist check triggered. Note: This does not verify new downloads were queued.")

def test_remove_playlist_from_watch(base_url):
    """Tests removing a playlist from the watch list."""
    # Add the playlist first to ensure it exists
    requests.put(f"{base_url}/playlist/watch/{SPOTIFY_PLAYLIST_ID}")
    
    # Now, remove it
    response = requests.delete(f"{base_url}/playlist/watch/{SPOTIFY_PLAYLIST_ID}")
    assert response.status_code == 200
    assert "Playlist removed from watch list" in response.json()["message"]

    # Verify it's no longer in the list
    response = requests.get(f"{base_url}/playlist/watch/list")
    assert response.status_code == 200
    watched_playlists = response.json()
    assert not any(p['spotify_id'] == SPOTIFY_PLAYLIST_ID for p in watched_playlists)

def test_remove_artist_from_watch(base_url):
    """Tests removing an artist from the watch list."""
    # Add the artist first to ensure it exists
    requests.put(f"{base_url}/artist/watch/{SPOTIFY_ARTIST_ID}")

    # Now, remove it
    response = requests.delete(f"{base_url}/artist/watch/{SPOTIFY_ARTIST_ID}")
    assert response.status_code == 200
    assert "Artist removed from watch list" in response.json()["message"]

    # Verify it's no longer in the list
    response = requests.get(f"{base_url}/artist/watch/list")
    assert response.status_code == 200
    watched_artists = response.json()
    assert not any(a['spotify_id'] == SPOTIFY_ARTIST_ID for a in watched_artists) 