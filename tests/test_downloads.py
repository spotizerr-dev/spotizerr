import requests
import pytest
import os
import shutil

# URLs for testing
SPOTIFY_TRACK_URL = "https://open.spotify.com/track/1Cts4YV9aOXVAP3bm3Ro6r"
SPOTIFY_ALBUM_URL = "https://open.spotify.com/album/4K0JVP5veNYTVI6IMamlla"
SPOTIFY_PLAYLIST_URL = "https://open.spotify.com/playlist/26CiMxIxdn5WhXyccMCPOB"
SPOTIFY_ARTIST_URL = "https://open.spotify.com/artist/7l6cdPhOLYO7lehz5xfzLV"

# Corresponding IDs extracted from URLs
TRACK_ID = SPOTIFY_TRACK_URL.split('/')[-1].split('?')[0]
ALBUM_ID = SPOTIFY_ALBUM_URL.split('/')[-1].split('?')[0]
PLAYLIST_ID = SPOTIFY_PLAYLIST_URL.split('/')[-1].split('?')[0]
ARTIST_ID = SPOTIFY_ARTIST_URL.split('/')[-1].split('?')[0]

DOWNLOAD_DIR = "downloads/"


def get_downloaded_files(directory=DOWNLOAD_DIR):
    """Walks a directory and returns a list of all file paths."""
    file_paths = []
    if not os.path.isdir(directory):
        return file_paths
    for root, _, files in os.walk(directory):
        for file in files:
            # Ignore hidden files like .DS_Store
            if not file.startswith('.'):
                file_paths.append(os.path.join(root, file))
    return file_paths


@pytest.fixture(autouse=True)
def cleanup_downloads_dir():
    """
    Ensures the download directory is removed and recreated, providing a clean
    slate before and after each test.
    """
    if os.path.exists(DOWNLOAD_DIR):
        shutil.rmtree(DOWNLOAD_DIR)
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    yield
    if os.path.exists(DOWNLOAD_DIR):
        shutil.rmtree(DOWNLOAD_DIR)


@pytest.fixture
def reset_config(base_url):
    """
    Fixture to get original config, set single concurrent download for test
    isolation, and restore the original config after the test.
    """
    response = requests.get(f"{base_url}/config")
    original_config = response.json()

    # Set max concurrent downloads to 1 for all tests using this fixture.
    requests.post(f"{base_url}/config", json={"maxConcurrentDownloads": 1})

    yield

    # Restore original config
    requests.post(f"{base_url}/config", json=original_config)


@pytest.mark.parametrize("download_type, item_id, timeout, expected_files_min", [
    ("track", TRACK_ID, 600, 1),
    ("album", ALBUM_ID, 900, 14),    # "After Hours" has 14 tracks
    ("playlist", PLAYLIST_ID, 1200, 4), # Test playlist has 4 tracks
])
def test_spotify_download_and_verify_files(base_url, task_waiter, reset_config, download_type, item_id, timeout, expected_files_min):
    """
    Tests downloading a track, album, or playlist and verifies that the
    expected number of files are created on disk.
    """
    print(f"\n--- Testing Spotify-only '{download_type}' download and verifying files ---")
    config_payload = {
        "service": "spotify",
        "fallback": False,
        "realTime": True,
        "spotifyQuality": "NORMAL"
    }
    requests.post(f"{base_url}/config", json=config_payload)

    response = requests.get(f"{base_url}/{download_type}/download/{item_id}")
    assert response.status_code == 202
    task_id = response.json()["task_id"]
    
    final_status = task_waiter(task_id, timeout=timeout)
    assert final_status["status"] == "complete", f"Task failed for {download_type} {item_id}: {final_status.get('error')}"

    # Verify that the correct number of files were downloaded
    downloaded_files = get_downloaded_files()
    assert len(downloaded_files) >= expected_files_min, (
        f"Expected at least {expected_files_min} file(s) for {download_type} {item_id}, "
        f"but found {len(downloaded_files)}."
    )


def test_artist_download_and_verify_files(base_url, task_waiter, reset_config):
    """
    Tests queuing an artist download and verifies that files are created.
    Does not check for exact file count due to the variability of artist discographies.
    """
    print("\n--- Testing Spotify-only artist download and verifying files ---")
    config_payload = {"service": "spotify", "fallback": False, "realTime": True, "spotifyQuality": "NORMAL"}
    requests.post(f"{base_url}/config", json=config_payload)

    response = requests.get(f"{base_url}/artist/download/{ARTIST_ID}?album_type=album,single")
    assert response.status_code == 202
    response_data = response.json()
    queued_albums = response_data.get("queued_albums", [])
    assert len(queued_albums) > 0, "No albums were queued for the artist."

    for album in queued_albums:
        task_id = album["task_id"]
        print(f"--- Waiting for artist album: {album['name']} ({task_id}) ---")
        final_status = task_waiter(task_id, timeout=900)
        assert final_status["status"] == "complete", f"Artist album task {album['name']} failed: {final_status.get('error')}"

    # After all tasks complete, verify that at least some files were downloaded.
    downloaded_files = get_downloaded_files()
    assert len(downloaded_files) > 0, "Artist download ran but no files were found in the download directory."


def test_download_with_deezer_fallback_and_verify_files(base_url, task_waiter, reset_config):
    """Tests downloading with Deezer fallback and verifies the file exists."""
    print("\n--- Testing track download with Deezer fallback and verifying files ---")
    config_payload = {
        "service": "spotify",
        "fallback": True,
        "deezerQuality": "FLAC"  # Test with high quality fallback
    }
    requests.post(f"{base_url}/config", json=config_payload)

    response = requests.get(f"{base_url}/track/download/{TRACK_ID}")
    assert response.status_code == 202
    task_id = response.json()["task_id"]
    
    final_status = task_waiter(task_id)
    assert final_status["status"] == "complete", f"Task failed with fallback: {final_status.get('error')}"

    # Verify that at least one file was downloaded.
    downloaded_files = get_downloaded_files()
    assert len(downloaded_files) >= 1, "Fallback download completed but no file was found."


def test_download_without_realtime_and_verify_files(base_url, task_waiter, reset_config):
    """Tests a non-realtime download and verifies the file exists."""
    print("\n--- Testing download with realTime: False and verifying files ---")
    config_payload = {
        "service": "spotify",
        "fallback": False,
        "realTime": False,
        "spotifyQuality": "NORMAL"
    }
    requests.post(f"{base_url}/config", json=config_payload)

    response = requests.get(f"{base_url}/track/download/{TRACK_ID}")
    assert response.status_code == 202
    task_id = response.json()["task_id"]

    final_status = task_waiter(task_id)
    assert final_status["status"] == "complete", f"Task failed with realTime=False: {final_status.get('error')}"

    # Verify that at least one file was downloaded.
    downloaded_files = get_downloaded_files()
    assert len(downloaded_files) >= 1, "Non-realtime download completed but no file was found."


# Aligned with formats in src/js/config.ts's CONVERSION_FORMATS
@pytest.mark.parametrize("format_name,bitrate,expected_ext", [
    ("mp3", "320k", ".mp3"),
    ("aac", "256k", ".m4a"),  # AAC is typically in an M4A container
    ("ogg", "320k", ".ogg"),
    ("opus", "256k", ".opus"),
    ("flac", None, ".flac"),
    ("wav", None, ".wav"),
    ("alac", None, ".m4a"),  # ALAC is also in an M4A container
])
def test_download_with_conversion_and_verify_format(base_url, task_waiter, reset_config, format_name, bitrate, expected_ext):
    """
    Tests downloading a track with various conversion formats and verifies
    that the created file has the correct extension.
    """
    print(f"\n--- Testing conversion: {format_name.upper()} @ {bitrate or 'default'} ---")
    config_payload = {
        "service": "spotify",
        "fallback": False,
        "realTime": True,
        "spotifyQuality": "NORMAL",
        "convertTo": format_name.upper(),
        "bitrate": bitrate
    }
    requests.post(f"{base_url}/config", json=config_payload)

    response = requests.get(f"{base_url}/track/download/{TRACK_ID}")
    assert response.status_code == 202
    task_id = response.json()["task_id"]
    
    final_status = task_waiter(task_id)
    assert final_status["status"] == "complete", f"Download failed for format {format_name} bitrate {bitrate}: {final_status.get('error')}"

    # Verify that a file with the correct extension was created.
    downloaded_files = get_downloaded_files()
    assert len(downloaded_files) >= 1, "Conversion download completed but no file was found."
    
    found_correct_format = any(f.lower().endswith(expected_ext) for f in downloaded_files)
    assert found_correct_format, (
        f"No file with expected extension '{expected_ext}' found for format '{format_name}'. "
        f"Found files: {downloaded_files}"
    ) 