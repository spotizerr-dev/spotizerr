import requests
import pytest
import time

# Use a known, short track for quick tests
TRACK_ID = "1Cts4YV9aOXVAP3bm3Ro6r"
# Use a long playlist to ensure there's time to cancel it
LONG_PLAYLIST_ID = "6WsyUEITURbQXZsqtEewb1" # Today's Top Hits on Spotify

@pytest.fixture
def reset_config(base_url):
    """Fixture to reset the main config after a test."""
    response = requests.get(f"{base_url}/config")
    original_config = response.json()
    yield
    requests.post(f"{base_url}/config", json=original_config)

def test_list_tasks(base_url, reset_config):
    """Tests listing all active tasks."""
    config_payload = {"service": "spotify", "fallback": False, "realTime": True}
    requests.post(f"{base_url}/config", json=config_payload)

    # Start a task
    response = requests.get(f"{base_url}/track/download/{TRACK_ID}")
    assert response.status_code == 202
    task_id = response.json()["task_id"]

    # Check the list to see if our task appears
    response = requests.get(f"{base_url}/prgs/list")
    assert response.status_code == 200
    tasks = response.json()
    assert isinstance(tasks, list)
    assert any(t['task_id'] == task_id for t in tasks)

    # Clean up by cancelling the task
    requests.post(f"{base_url}/prgs/cancel/{task_id}")

def test_get_task_progress_and_log(base_url, task_waiter, reset_config):
    """Tests getting progress for a running task and retrieving its log after completion."""
    config_payload = {"service": "spotify", "fallback": False, "realTime": True}
    requests.post(f"{base_url}/config", json=config_payload)

    response = requests.get(f"{base_url}/track/download/{TRACK_ID}")
    assert response.status_code == 202
    task_id = response.json()["task_id"]

    # Poll progress a few times while it's running to check the endpoint
    for _ in range(3):
        time.sleep(1)
        res = requests.get(f"{base_url}/prgs/{task_id}")
        if res.status_code == 200 and res.json():
            statuses = res.json()
            assert isinstance(statuses, list)
            assert "status" in statuses[-1]
            break
    else:
        pytest.fail("Could not get a valid task status in time.")

    # Wait for completion
    final_status = task_waiter(task_id)
    assert final_status["status"] == "complete"

    # After completion, check the task log endpoint
    res = requests.get(f"{base_url}/prgs/{task_id}?log=true")
    assert res.status_code == 200
    log_data = res.json()
    assert "task_log" in log_data
    assert len(log_data["task_log"]) > 0
    assert "status" in log_data["task_log"][0]

def test_cancel_task(base_url, reset_config):
    """Tests cancelling a task shortly after it has started."""
    config_payload = {"service": "spotify", "fallback": False, "realTime": True}
    requests.post(f"{base_url}/config", json=config_payload)
    
    response = requests.get(f"{base_url}/playlist/download/{LONG_PLAYLIST_ID}")
    assert response.status_code == 202
    task_id = response.json()["task_id"]

    # Give it a moment to ensure it has started processing
    time.sleep(3)

    # Cancel the task
    response = requests.post(f"{base_url}/prgs/cancel/{task_id}")
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"

    # Check the final status to confirm it's marked as cancelled
    time.sleep(2) # Allow time for the final status to propagate
    res = requests.get(f"{base_url}/prgs/{task_id}")
    assert res.status_code == 200
    last_status = res.json()[-1]
    assert last_status["status"] == "cancelled" 