import pytest
import requests
import time
import os
import json
from dotenv import load_dotenv

# Load environment variables from .env file in the project root
load_dotenv()

# --- Environment-based secrets for testing ---
SPOTIFY_API_CLIENT_ID = os.environ.get("SPOTIFY_API_CLIENT_ID", "your_spotify_client_id")
SPOTIFY_API_CLIENT_SECRET = os.environ.get("SPOTIFY_API_CLIENT_SECRET", "your_spotify_client_secret")
SPOTIFY_BLOB_CONTENT_STR = os.environ.get("SPOTIFY_BLOB_CONTENT", '{}')
try:
    SPOTIFY_BLOB_CONTENT = json.loads(SPOTIFY_BLOB_CONTENT_STR)
except json.JSONDecodeError:
    SPOTIFY_BLOB_CONTENT = {}

DEEZER_ARL = os.environ.get("DEEZER_ARL", "your_deezer_arl")

# --- Standard names for test accounts ---
SPOTIFY_ACCOUNT_NAME = "test-spotify-account"
DEEZER_ACCOUNT_NAME = "test-deezer-account"


@pytest.fixture(scope="session")
def base_url():
    """Provides the base URL for the API tests."""
    return "http://localhost:7171/api"


def wait_for_task(base_url, task_id, timeout=600):
    """
    Waits for a Celery task to reach a terminal state (complete, error, etc.).
    Polls the progress endpoint and prints status updates.
    """
    print(f"\n--- Waiting for task {task_id} (timeout: {timeout}s) ---")
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            response = requests.get(f"{base_url}/prgs/{task_id}")
            if response.status_code == 404:
                time.sleep(1)
                continue
            
            response.raise_for_status() # Raise an exception for bad status codes
            
            data = response.json()
            if not data or not data.get("last_line"):
                time.sleep(1)
                continue
            
            last_status = data["last_line"]
            status = last_status.get("status")
            
            # More verbose logging for debugging during tests
            message = last_status.get('message', '')
            track = last_status.get('track', '')
            progress = last_status.get('overall_progress', '')
            print(f"Task {task_id} | Status: {status:<12} | Progress: {progress or 'N/A':>3}% | Track: {track:<30} | Message: {message}")

            if status in ["complete", "ERROR", "cancelled", "ERROR_RETRIED", "ERROR_AUTO_CLEANED"]:
                print(f"--- Task {task_id} finished with status: {status} ---")
                return last_status
            
            time.sleep(2)
        except requests.exceptions.RequestException as e:
            print(f"Warning: Request to fetch task status for {task_id} failed: {e}. Retrying...")
            time.sleep(5)
        
    raise TimeoutError(f"Task {task_id} did not complete within {timeout} seconds.")


@pytest.fixture(scope="session")
def task_waiter(base_url):
    """Provides a fixture that returns the wait_for_task helper function."""
    def _waiter(task_id, timeout=600):
        return wait_for_task(base_url, task_id, timeout)
    return _waiter


@pytest.fixture(scope="session", autouse=True)
def setup_credentials_for_tests(base_url):
    """
    A session-wide, automatic fixture to set up all necessary credentials.
    It runs once before any tests, and tears down the credentials after all tests are complete.
    """
    print("\n--- Setting up credentials for test session ---")
    
    print("\n--- DEBUGGING CREDENTIALS ---")
    print(f"SPOTIFY_API_CLIENT_ID: {SPOTIFY_API_CLIENT_ID}")
    print(f"SPOTIFY_API_CLIENT_SECRET: {SPOTIFY_API_CLIENT_SECRET}")
    print(f"DEEZER_ARL: {DEEZER_ARL}")
    print(f"SPOTIFY_BLOB_CONTENT {SPOTIFY_BLOB_CONTENT}")
    print("--- END DEBUGGING ---\n")

    # Skip all tests if secrets are not provided in the environment
    if SPOTIFY_API_CLIENT_ID == "your_spotify_client_id" or \
       SPOTIFY_API_CLIENT_SECRET == "your_spotify_client_secret" or \
       not SPOTIFY_BLOB_CONTENT or \
       DEEZER_ARL == "your_deezer_arl":
        pytest.skip("Required credentials not provided in .env file or environment. Skipping credential-dependent tests.")

    # 1. Set global Spotify API creds
    data = {"client_id": SPOTIFY_API_CLIENT_ID, "client_secret": SPOTIFY_API_CLIENT_SECRET}
    response = requests.put(f"{base_url}/credentials/spotify_api_config", json=data)
    if response.status_code != 200:
        pytest.fail(f"Failed to set global Spotify API creds: {response.text}")
    print("Global Spotify API credentials set.")

    # 2. Delete any pre-existing test credentials to ensure a clean state
    requests.delete(f"{base_url}/credentials/spotify/{SPOTIFY_ACCOUNT_NAME}")
    requests.delete(f"{base_url}/credentials/deezer/{DEEZER_ACCOUNT_NAME}")
    print("Cleaned up any old test credentials.")

    # 3. Create Deezer credential
    data = {"name": DEEZER_ACCOUNT_NAME, "arl": DEEZER_ARL, "region": "US"}
    response = requests.post(f"{base_url}/credentials/deezer/{DEEZER_ACCOUNT_NAME}", json=data)
    if response.status_code != 201:
        pytest.fail(f"Failed to create Deezer credential: {response.text}")
    print("Deezer test credential created.")
    
    # 4. Create Spotify credential
    data = {"name": SPOTIFY_ACCOUNT_NAME, "blob_content": SPOTIFY_BLOB_CONTENT, "region": "US"}
    response = requests.post(f"{base_url}/credentials/spotify/{SPOTIFY_ACCOUNT_NAME}", json=data)
    if response.status_code != 201:
         pytest.fail(f"Failed to create Spotify credential: {response.text}")
    print("Spotify test credential created.")

    # 5. Set main config to use these accounts for downloads
    config_payload = {
        "spotify": SPOTIFY_ACCOUNT_NAME,
        "deezer": DEEZER_ACCOUNT_NAME,
    }
    response = requests.post(f"{base_url}/config", json=config_payload)
    if response.status_code != 200:
        pytest.fail(f"Failed to set main config for tests: {response.text}")
    print("Main config set to use test credentials.")

    yield # This is where the tests will run

    # --- Teardown ---
    print("\n--- Tearing down test credentials ---")
    response = requests.delete(f"{base_url}/credentials/spotify/{SPOTIFY_ACCOUNT_NAME}")
    assert response.status_code in [200, 404]
    response = requests.delete(f"{base_url}/credentials/deezer/{DEEZER_ACCOUNT_NAME}")
    assert response.status_code in [200, 404]
    print("Test credentials deleted.") 