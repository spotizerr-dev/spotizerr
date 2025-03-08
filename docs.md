# Spotizerr Documentation

## Table of Contents
1. [Introduction](#introduction)
2. [Architecture Overview](#architecture-overview)
3. [Core Components](#core-components)
   - [Backend (Flask)](#backend-flask)
   - [Frontend (HTML/CSS/JavaScript)](#frontend-htmlcssjavascript)
4. [Authentication and Credentials](#authentication-and-credentials)
5. [Download Mechanism](#download-mechanism)
6. [Configuration System](#configuration-system)
7. [API Reference](#api-reference)
8. [Docker Deployment](#docker-deployment)
9. [Development Guide](#development-guide)

## Introduction

Spotizerr is a web application that combines the best of two worlds: Spotify's catalog and Deezer's quality for music downloads. The application allows users to search for tracks, albums, playlists, and artists using Spotify's search API, and then download the content with options to use either Spotify or Deezer as the source, with a fallback mechanism if needed.

The main goals of the application are:
- Provide a user-friendly interface for browsing and searching music
- Enable high-quality music downloads from either Spotify or Deezer
- Manage download queue and progress in real-time
- Support dual-service integration with credential management

## Architecture Overview

Spotizerr follows a client-server architecture with a clear separation between the backend and frontend components:

1. **Backend**: A Flask-based Python application that handles:
   - API endpoints for search, download, and credential management
   - Service integration with Spotify and Deezer
   - Download management and progress tracking
   - Configuration and credentials storage

2. **Frontend**: HTML/CSS/JavaScript application that provides:
   - User interface for searching and browsing content
   - Download queue management
   - Configuration management
   - Real-time progress monitoring

3. **Docker Integration**: The application is containerized using Docker for easy deployment and isolation.

The application uses a combination of synchronous and asynchronous processing to handle downloads efficiently while maintaining responsiveness.

## Core Components

### Backend (Flask)

The backend is structured around Flask Blueprints, which organize the API into logical modules:

1. **Main Application (`app.py`)**:
   - Initializes the Flask application
   - Registers blueprints for different API endpoints
   - Sets up logging and error handling
   - Defines frontend routes

2. **Route Modules**:
   - `search.py`: Handles music search functionality
   - `track.py`: Manages track information and downloads
   - `album.py`: Manages album information and downloads
   - `playlist.py`: Manages playlist information and downloads
   - `artist.py`: Manages artist information and downloads
   - `credentials.py`: Handles credential management
   - `config.py`: Manages application configuration
   - `prgs.py`: Handles progress tracking for downloads

3. **Utility Modules** (in `routes/utils/`):
   - `queue.py`: Implements the download queue system
   - `credentials.py`: Utility functions for credential management
   - `track.py`, `album.py`, `artist.py`, `playlist.py`: Resource-specific utility functions
   - `search.py`: Utilities for searching music
   - `get_info.py`: Functions for retrieving metadata

The backend runs on port 7171 and uses the Waitress WSGI server for production deployment.

### Frontend (HTML/CSS/JavaScript)

The frontend is built with vanilla JavaScript and is organized around different views:

1. **Main Page (`main.html`/`main.js`)**:
   - Search interface
   - Results display
   - Navigation to other views
   - Initial download functionality

2. **Resource-specific Pages**:
   - `track.html`/`track.js`: Track details and download
   - `album.html`/`album.js`: Album details and download
   - `playlist.html`/`playlist.js`: Playlist details and download
   - `artist.html`/`artist.js`: Artist details and download
   - `config.html`/`config.js`: Configuration management

3. **Download Queue System (`queue.js`)**:
   - Manages download queue UI
   - Tracks download progress
   - Provides controls for cancel/retry
   - Groups downloads by status

The frontend uses client-side routing for navigation between different views and AJAX for API communication.

## Authentication and Credentials

Spotizerr manages service credentials for both Spotify and Deezer:

1. **Spotify Credentials**:
   - Requires username and authentication token
   - Generated using the `librespot-auth` tool
   - Stored in `./creds/spotify/<account_name>/credentials.json`

2. **Deezer Credentials**:
   - Uses ARL (Application Request Limit) token
   - Retrieved from browser cookies
   - Stored in `./creds/deezer/<account_name>/credentials.json`

3. **Credential Management**:
   - Multiple accounts can be configured for each service
   - One account can be set as active per service
   - Credentials are managed through the configuration page
   - Credentials are stored in plaintext (security consideration)

The application does not have user authentication, meaning anyone with access to the application can use the configured services.

## Download Mechanism

The download system is a core component of Spotizerr and uses a sophisticated approach:

1. **Download Queue**:
   - Manages concurrent downloads (configurable limit)
   - Tracks progress of each download
   - Provides status updates in real-time
   - Supports cancellation and retry operations

2. **Progress Tracking**:
   - Uses `.prg` files to store download progress
   - Each download has a randomly generated identifier
   - Progress is tracked in real-time
   - Client polls for updates via API

3. **Service Fallback**:
   - Can be configured to use Deezer as primary source with Spotify as fallback
   - If a track is not found on the primary service, it automatically tries the fallback
   - Quality settings can be specified for both primary and fallback services

4. **Quality Selection**:
   - For Spotify: OGG 96k, 160k, and 320k (premium only)
   - For Deezer: MP3 128k, MP3 320k, and FLAC (premium only)

5. **Real-time Downloading**:
   - For Spotify, can match download timing with track length for rate limiting
   - Helps with account longevity by simulating normal usage patterns

6. **Custom Formatting**:
   - Configurable directory structure
   - Customizable file naming patterns
   - Metadata preservation

### Download Process Flow

1. User initiates download (track, album, playlist, or artist)
2. Frontend adds task to download queue
3. Backend processes task based on resource type:
   - For single tracks: Direct download
   - For albums: Retrieves track list, then downloads each track
   - For playlists: Retrieves track list, then downloads each track
   - For artists: Retrieves albums (optionally filtered by type), then downloads each album's tracks
4. Progress is tracked and reported back to frontend
5. On completion, downloaded files are organized according to configured patterns

## Configuration System

The configuration system is managed through a JSON file (`./config/main.json`) and provides the following settings:

1. **Service Settings**:
   - Active account selection for each service
   - Fallback system configuration
   - Quality preferences

2. **Download Settings**:
   - Maximum concurrent downloads
   - Directory and file naming patterns
   - Real-time download option

3. **Storage**:
   - Configuration is stored in JSON format
   - Changes through the UI are persisted immediately
   - Settings are applied in real-time

4. **UI Preferences**:
   - Search type preference (remembered between sessions)
   - Queue display settings
   - Theme and layout options (if implemented)

## API Reference

Spotizerr's backend exposes several API endpoints organized by resource type:

### Search API

- `GET /api/search?query={query}&type={type}`: Search for music resources by query and type (track, album, playlist, artist)

### Track API

- `GET /api/track/download?service={service}&url={url}&main={main_account}&fallback={fallback_account}&quality={quality}&fall_quality={fallback_quality}&real_time={real_time}`: Download a track
- `GET /api/track/download/cancel?prg_file={prg_file}`: Cancel a track download
- `GET /api/track/info?url={url}`: Get track information

### Album API

- `GET /api/album/info?url={url}`: Get album information and tracks
- `GET /api/album/download?...`: Download an album (similar parameters to track)

### Playlist API

- `GET /api/playlist/info?url={url}`: Get playlist information and tracks
- `GET /api/playlist/download?...`: Download a playlist (similar parameters to track)

### Artist API

- `GET /api/artist/info?url={url}`: Get artist information and albums
- `GET /api/artist/download?...`: Download an artist's albums (similar parameters to track, with album_type parameter)

### Credentials API

- `GET /api/credentials/list`: List all configured credentials
- `POST /api/credentials/spotify/add`: Add Spotify credentials
- `POST /api/credentials/deezer/add`: Add Deezer credentials
- `DELETE /api/credentials/{service}/{account}`: Delete credentials

### Configuration API

- `GET /api/config`: Get current configuration
- `POST /api/config`: Update configuration

### Progress API

- `GET /api/prgs/{filename}`: Get progress information for a specific download
- `DELETE /api/prgs/delete/{filename}`: Delete a progress file
- `GET /api/prgs/list`: List all progress files

## Docker Deployment

Spotizerr is designed to be deployed using Docker, which provides isolation and easier deployment:

1. **Docker Image**:
   - Built from the Python 3.12 slim image
   - Includes system dependencies (git, ffmpeg)
   - Installs Python dependencies from requirements.txt
   - Uses an entrypoint script to handle permissions

2. **Volume Mounts**:
   - `./creds:/app/creds`: For credential storage
   - `./config:/app/config`: For configuration
   - `./downloads:/app/downloads`: For downloaded music

3. **User Permissions**:
   - Can run as a specific user ID (PUID) and group ID (PGID)
   - Ensures downloaded files have correct ownership
   - Optional UMASK setting for file permissions

4. **Build and Deployment**:
   - Development build (`dev.build.sh`): Tags as 'dev'
   - Production build (`latest.build.sh`): Tags as 'latest'
   - Both scripts support multi-architecture builds (amd64, arm64)

### Docker Compose Example

```yaml
name: spotizerr

services:
  spotizerr:
    volumes:
      - ./creds:/app/creds
      - ./config:/app/config
      - ./downloads:/app/downloads  # <-- Change this for your music library dir
    ports:
      - 7171:7171
    image: cooldockerizer93/spotizerr
    environment:
      - PUID=1000  # Replace with your desired user ID
      - PGID=1000  # Replace with your desired group ID
      - UMASK=0022 # Optional: Sets default file permissions
```

## Development Guide

For developers interested in extending or modifying Spotizerr, here's a guide to the development workflow:

1. **Environment Setup**:
   - Clone the repository
   - Create a Python virtual environment
   - Install dependencies: `pip install -r requirements.txt`
   - Set up Spotify and Deezer credentials

2. **Key Libraries**:
   - `deezspot`: Modified library for Spotify and Deezer integration
   - `Flask`: Web framework for the backend
   - `librespot`: For Spotify authentication
   - Various audio processing libraries

3. **Adding New Features**:
   - For new API endpoints: Create or modify Flask blueprints
   - For new UI features: Add to the appropriate JavaScript file
   - For new resource types: Model after existing implementations (track, album, etc.)

4. **Testing**:
   - Manual testing is the primary method
   - Test with both free and premium accounts to verify quality options
   - Verify fallback behavior with intentionally failed lookups

5. **Building**:
   - Docker build scripts in the `builds` directory
   - Test with development tag before pushing to latest

6. **Security Considerations**:
   - No built-in authentication - add a security layer if exposing publicly
   - Credential storage is in plaintext - secure the credentials directory
   - Input validation to prevent path traversal attacks

This documentation provides a comprehensive overview of the Spotizerr application architecture, functionality, and deployment. It's designed to help users, administrators, and developers understand how the system works and how to effectively use or extend it. 