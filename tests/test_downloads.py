import requests
import pytest

# URLs provided by the user for testing
SPOTIFY_TRACK_URL = "https://open.spotify.com/track/1Cts4YV9aOXVAP3bm3Ro6r"
SPOTIFY_ALBUM_URL = "https://open.spotify.com/album/4K0JVP5veNYTVI6IMamlla"
SPOTIFY_PLAYLIST_URL = "https://open.spotify.com/playlist/26CiMxIxdn5WhXyccMCPOB"
SPOTIFY_ARTIST_URL = "https://open.spotify.com/artist/7l6cdPhOLYO7lehz5xfzLV"

# Corresponding IDs extracted from URLs
TRACK_ID = SPOTIFY_TRACK_URL.split('/')[-1].split('?')[0]
ALBUM_ID = SPOTIFY_ALBUM_URL.split('/')[-1].split('?')[0]
PLAYLIST_ID = SPOTIFY_PLAYLIST_URL.split('/')[-1].split('?')[0]
ARTIST_ID = SPOTIFY_ARTIST_URL.split('/')[-1].split('?')[0]

@pytest.fixture
def reset_config(base_url):
    """Fixture to reset the main config after a test to avoid side effects."""
    response = requests.get(f"{base_url}/config")
    original_config = response.json()
    yield
    requests.post(f"{base_url}/config", json=original_config)

def test_download_track_spotify_only(base_url, task_waiter, reset_config):
    """Tests downloading a single track from Spotify with real-time download enabled."""
    print("\n--- Testing Spotify-only track download ---")
    config_payload = {
        "service": "spotify",
        "fallback": False,
        "realTime": True,
        "spotifyQuality": "NORMAL"  # Simulating free account quality
    }
    requests.post(f"{base_url}/config", json=config_payload)

    response = requests.get(f"{base_url}/track/download/{TRACK_ID}")
    assert response.status_code == 202
    task_id = response.json()["task_id"]
    
    final_status = task_waiter(task_id)
    assert final_status["status"] == "complete", f"Task failed: {final_status.get('error')}"

def test_download_album_spotify_only(base_url, task_waiter, reset_config):
    """Tests downloading a full album from Spotify with real-time download enabled."""
    print("\n--- Testing Spotify-only album download ---")
    config_payload = {"service": "spotify", "fallback": False, "realTime": True, "spotifyQuality": "NORMAL"}
    requests.post(f"{base_url}/config", json=config_payload)

    response = requests.get(f"{base_url}/album/download/{ALBUM_ID}")
    assert response.status_code == 202
    task_id = response.json()["task_id"]
    
    final_status = task_waiter(task_id, timeout=900)
    assert final_status["status"] == "complete", f"Task failed: {final_status.get('error')}"

def test_download_playlist_spotify_only(base_url, task_waiter, reset_config):
    """Tests downloading a full playlist from Spotify with real-time download enabled."""
    print("\n--- Testing Spotify-only playlist download ---")
    config_payload = {"service": "spotify", "fallback": False, "realTime": True, "spotifyQuality": "NORMAL"}
    requests.post(f"{base_url}/config", json=config_payload)

    response = requests.get(f"{base_url}/playlist/download/{PLAYLIST_ID}")
    assert response.status_code == 202
    task_id = response.json()["task_id"]
    
    final_status = task_waiter(task_id, timeout=1200)
    assert final_status["status"] == "complete", f"Task failed: {final_status.get('error')}"

def test_download_artist_spotify_only(base_url, task_waiter, reset_config):
    """Tests queuing downloads for an artist's entire discography from Spotify."""
    print("\n--- Testing Spotify-only artist download ---")
    config_payload = {"service": "spotify", "fallback": False, "realTime": True, "spotifyQuality": "NORMAL"}
    requests.post(f"{base_url}/config", json=config_payload)

    response = requests.get(f"{base_url}/artist/download/{ARTIST_ID}?album_type=album,single")
    assert response.status_code == 202
    response_data = response.json()
    queued_albums = response_data.get("successfully_queued_albums", [])
    assert len(queued_albums) > 0, "No albums were queued for the artist."

    for album in queued_albums:
        task_id = album["task_id"]
        print(f"--- Waiting for artist album: {album['name']} ({task_id}) ---")
        final_status = task_waiter(task_id, timeout=900)
        assert final_status["status"] == "complete", f"Artist album task {album['name']} failed: {final_status.get('error')}"

def test_download_track_with_fallback(base_url, task_waiter, reset_config):
    """Tests downloading a Spotify track with Deezer fallback enabled."""
    print("\n--- Testing track download with Deezer fallback ---")
    config_payload = {
        "service": "spotify",
        "fallback": True,
        "deezerQuality": "MP3_320"  # Simulating higher quality from Deezer free
    }
    requests.post(f"{base_url}/config", json=config_payload)

    response = requests.get(f"{base_url}/track/download/{TRACK_ID}")
    assert response.status_code == 202
    task_id = response.json()["task_id"]
    
    final_status = task_waiter(task_id)
    assert final_status["status"] == "complete", f"Task failed: {final_status.get('error')}"

@pytest.mark.parametrize("format,bitrate", [
    ("mp3", "320"), ("mp3", "128"),
    ("flac", None),
    ("ogg", "160"),
    ("opus", "128"),
    ("m4a", "128k")
])
def test_download_with_conversion(base_url, task_waiter, reset_config, format, bitrate):
    """Tests downloading a track with various conversion formats and bitrates."""
    print(f"\n--- Testing conversion: {format} @ {bitrate or 'default'} ---")
    config_payload = {
        "service": "spotify",
        "fallback": False,
        "realTime": True,
        "spotifyQuality": "NORMAL",
        "convertTo": format,
        "bitrate": bitrate
    }
    requests.post(f"{base_url}/config", json=config_payload)

    response = requests.get(f"{base_url}/track/download/{TRACK_ID}")
    assert response.status_code == 202
    task_id = response.json()["task_id"]
    
    final_status = task_waiter(task_id)
    assert final_status["status"] == "complete", f"Download failed for format {format} bitrate {bitrate}: {final_status.get('error')}" 