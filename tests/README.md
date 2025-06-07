# Spotizerr Backend Tests

This directory contains automated tests for the Spotizerr backend API.

## Prerequisites

1.  **Running Backend**: Ensure the Spotizerr Flask application is running and accessible at `http://localhost:7171`. You can start it with `python app.py`.

2.  **Python Dependencies**: Install the necessary Python packages for testing.
    ```bash
    pip install pytest requests python-dotenv
    ```

3.  **Credentials**: These tests require valid Spotify and Deezer credentials. Create a file named `.env` in the root directory of the project (`spotizerr`) and add your credentials to it. The tests will load this file automatically.

    **Example `.env` file:**
    ```
    SPOTIFY_API_CLIENT_ID="your_spotify_client_id"
    SPOTIFY_API_CLIENT_SECRET="your_spotify_client_secret"
    # This should be the full JSON content of your credentials blob as a single line string
    SPOTIFY_BLOB_CONTENT='{"username": "your_spotify_username", "password": "your_spotify_password", ...}'
    DEEZER_ARL="your_deezer_arl"
    ```

    The tests will automatically use these credentials to create and manage test accounts named `test-spotify-account` and `test-deezer-account`.

## Running Tests

To run all tests, navigate to the root directory of the project (`spotizerr`) and run `pytest`:

```bash
pytest
```

To run a specific test file:

```bash
pytest tests/test_downloads.py
```

For more detailed output, use the `-v` (verbose) and `-s` (show print statements) flags:
```bash
pytest -v -s
``` 