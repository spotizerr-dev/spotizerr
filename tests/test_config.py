import requests
import pytest

@pytest.fixture
def reset_config(base_url):
    """A fixture to ensure the main config is reset after a test case."""
    response = requests.get(f"{base_url}/config")
    assert response.status_code == 200
    original_config = response.json()
    yield
    response = requests.post(f"{base_url}/config", json=original_config)
    assert response.status_code == 200

def test_get_main_config(base_url):
    """Tests if the main configuration can be retrieved."""
    response = requests.get(f"{base_url}/config")
    assert response.status_code == 200
    config = response.json()
    assert "service" in config
    assert "maxConcurrentDownloads" in config
    assert "spotify" in config  # Should be set by conftest
    assert "deezer" in config   # Should be set by conftest

def test_update_main_config(base_url, reset_config):
    """Tests updating various fields in the main configuration."""
    new_settings = {
        "maxConcurrentDownloads": 5,
        "spotifyQuality": "HIGH",
        "deezerQuality": "FLAC",
        "customDirFormat": "%artist%/%album%",
        "customTrackFormat": "%tracknum% %title%",
        "save_cover": False,
        "fallback": True,
    }

    response = requests.post(f"{base_url}/config", json=new_settings)
    assert response.status_code == 200
    updated_config = response.json()

    for key, value in new_settings.items():
        assert updated_config[key] == value

def test_get_watch_config(base_url):
    """Tests if the watch-specific configuration can be retrieved."""
    response = requests.get(f"{base_url}/config/watch")
    assert response.status_code == 200
    config = response.json()
    assert "delay_between_playlists_seconds" in config
    assert "delay_between_artists_seconds" in config

def test_update_watch_config(base_url):
    """Tests updating the watch-specific configuration."""
    response = requests.get(f"{base_url}/config/watch")
    original_config = response.json()

    new_settings = {
        "delay_between_playlists_seconds": 120,
        "delay_between_artists_seconds": 240,
        "auto_add_new_releases_to_queue": False,
    }

    response = requests.post(f"{base_url}/config/watch", json=new_settings)
    assert response.status_code == 200
    updated_config = response.json()

    for key, value in new_settings.items():
        assert updated_config[key] == value

    # Revert to original
    requests.post(f"{base_url}/config/watch", json=original_config)

def test_update_conversion_config(base_url, reset_config):
    """
    Iterates through all supported conversion formats and bitrates,
    updating the config and verifying the changes for each combination.
    """
    conversion_formats = ["mp3", "flac", "ogg", "opus", "m4a"]
    bitrates = {
        "mp3": ["320", "256", "192", "128"],
        "ogg": ["500", "320", "192", "160"],
        "opus": ["256", "192", "128", "96"],
        "m4a": ["320k", "256k", "192k", "128k"],
        "flac": [None]  # Bitrate is not applicable for FLAC
    }

    for format in conversion_formats:
        for br in bitrates.get(format, [None]):
            print(f"Testing conversion config: format={format}, bitrate={br}")
            new_settings = {"convertTo": format, "bitrate": br}
            response = requests.post(f"{base_url}/config", json=new_settings)
            assert response.status_code == 200
            updated_config = response.json()
            assert updated_config["convertTo"] == format
            assert updated_config["bitrate"] == br 