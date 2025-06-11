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
    assert "fallback" in config
    assert "realTime" in config
    assert "maxRetries" in config

def test_update_main_config(base_url, reset_config):
    """Tests updating various fields in the main configuration based on frontend capabilities."""
    new_settings = {
        "maxConcurrentDownloads": 5,
        "spotifyQuality": "HIGH",
        "deezerQuality": "FLAC",
        "customDirFormat": "%artist%/%album%",
        "customTrackFormat": "%tracknum% %title%",
        "save_cover": False,
        "fallback": True,
        "realTime": False,
        "maxRetries": 5,
        "retryDelaySeconds": 10,
        "retry_delay_increase": 10,
        "tracknum_padding": False,
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
    assert "enabled" in config
    assert "watchPollIntervalSeconds" in config
    assert "watchedArtistAlbumGroup" in config

def test_update_watch_config(base_url):
    """Tests updating the watch-specific configuration."""
    response = requests.get(f"{base_url}/config/watch")
    original_config = response.json()

    new_settings = {
        "enabled": False,
        "watchPollIntervalSeconds": 7200,
        "watchedArtistAlbumGroup": ["album", "single"],
    }

    response = requests.post(f"{base_url}/config/watch", json=new_settings)
    assert response.status_code == 200

    # The response for updating watch config is just a success message,
    # so we need to GET the config again to verify.
    verify_response = requests.get(f"{base_url}/config/watch")
    assert verify_response.status_code == 200
    updated_config = verify_response.json()

    for key, value in new_settings.items():
        assert updated_config[key] == value

    # Revert to original
    requests.post(f"{base_url}/config/watch", json=original_config)

def test_update_conversion_config(base_url, reset_config):
    """
    Iterates through supported conversion formats and bitrates from the frontend,
    updating the config and verifying the changes.
    """
    # Formats and bitrates aligned with src/js/config.ts
    conversion_formats = ["MP3", "AAC", "OGG", "OPUS", "FLAC", "WAV", "ALAC"]
    bitrates = {
        "MP3": ["128k", "320k"],
        "AAC": ["128k", "256k"],
        "OGG": ["128k", "320k"],
        "OPUS": ["96k", "256k"],
        "FLAC": [None],
        "WAV": [None],
        "ALAC": [None],
    }

    for format_val in conversion_formats:
        for br in bitrates.get(format_val, [None]):
            print(f"Testing conversion config: format={format_val}, bitrate={br}")
            new_settings = {"convertTo": format_val, "bitrate": br}
            response = requests.post(f"{base_url}/config", json=new_settings)

            assert response.status_code == 200
            updated_config = response.json()
            assert updated_config["convertTo"] == format_val
            # The backend might return null for empty bitrate, which is fine
            assert updated_config["bitrate"] == br 