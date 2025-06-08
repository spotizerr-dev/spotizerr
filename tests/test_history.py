import requests
import pytest
import time

TRACK_ID = "1Cts4YV9aOXVAP3bm3Ro6r" # Use a known, short track

@pytest.fixture
def reset_config(base_url):
    """Fixture to reset the main config after a test."""
    response = requests.get(f"{base_url}/config")
    original_config = response.json()
    yield
    requests.post(f"{base_url}/config", json=original_config)

def test_history_logging_and_filtering(base_url, task_waiter, reset_config):
    """
    Tests if a completed download appears in the history and
    verifies that history filtering works correctly.
    """
    # First, complete a download task to ensure there's a history entry
    config_payload = {"service": "spotify", "fallback": False, "realTime": True}
    requests.post(f"{base_url}/config", json=config_payload)
    response = requests.get(f"{base_url}/track/download/{TRACK_ID}")
    assert response.status_code == 202
    task_id = response.json()["task_id"]
    task_waiter(task_id) # Wait for the download to complete

    # Give a moment for history to be written if it's asynchronous
    time.sleep(2)

    # 1. Get all history and check if our task is present
    print("\n--- Verifying task appears in general history ---")
    response = requests.get(f"{base_url}/history")
    assert response.status_code == 200
    history_data = response.json()
    assert "entries" in history_data
    assert "total" in history_data
    assert history_data["total"] > 0
    
    # Find our specific task in the history
    history_entry = next((entry for entry in history_data["entries"] if entry['task_id'] == task_id), None)
    assert history_entry is not None, f"Task {task_id} not found in download history."
    assert history_entry["status_final"] == "COMPLETED"

    # 2. Test filtering for COMPLETED tasks
    print("\n--- Verifying history filtering for COMPLETED status ---")
    response = requests.get(f"{base_url}/history?filters[status_final]=COMPLETED")
    assert response.status_code == 200
    completed_history = response.json()
    assert completed_history["total"] > 0
    assert any(entry['task_id'] == task_id for entry in completed_history["entries"])
    assert all(entry['status_final'] == 'COMPLETED' for entry in completed_history["entries"])
    
    # 3. Test filtering for an item name
    print(f"\n--- Verifying history filtering for item_name: {history_entry['item_name']} ---")
    item_name_query = requests.utils.quote(history_entry['item_name'])
    response = requests.get(f"{base_url}/history?filters[item_name]={item_name_query}")
    assert response.status_code == 200
    named_history = response.json()
    assert named_history["total"] > 0
    assert any(entry['task_id'] == task_id for entry in named_history["entries"]) 