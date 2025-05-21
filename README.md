# SUPPORT YOUR ARTISTS

As of 2025, Spotify pays an average of $0.005 per stream to the artist. That means that if you give the equivalent of $5 directly to them (like merch, buying cds, or just donating), you can """ethically""" listen to them a total of 1000 times. Of course, nobody thinks spotify payment is fair, so preferably you should give more, but $5 is the bare minimum. Big names prolly don't need those $5 dollars, but it might be _the_ difference between going out of business or not for that indie rock band you like.

# Spotizerr

Music downloader which combines the best of two worlds: Spotify's catalog and Deezer's quality. Search for a track using Spotify search api, click download and, depending on your preferences, it will download directly from Spotify or firstly try to download from Deezer, if it fails, it'll fallback to Spotify.

## Desktop interface
![image](https://github.com/user-attachments/assets/8093085d-cad3-4cba-9a0d-1ad6cae63e4f)

![image](https://github.com/user-attachments/assets/ac5daa0f-769f-43b0-b78a-8db343219861)

![image](https://github.com/user-attachments/assets/fb8b2295-f6b6-412f-87da-69f63b56247c)

## Mobile interface

![Screen Shot 2025-03-15 at 21 02 27](https://github.com/user-attachments/assets/cee9318e-9451-4a43-9e24-20e05f4abc5b) ![Screen Shot 2025-03-15 at 21 02 45](https://github.com/user-attachments/assets/d5801795-ba31-4589-a82d-d208f1ea6d62)

## Features

- Browse through artist, albums, playlists and tracks and jump between them
- Dual-service integration (Spotify & Deezer)
- Direct URL downloads for Spotify tracks/albums/playlists/artists
- Search using spotify's catalog
- Credential management system
- Download queue with real-time progress
- Service fallback system when downloading*
- Real time downloading**
- Quality selector***
- Customizable track number padding (01. Track or 1. Track)
- Customizable retry parameters (max attempts, delay, increase per retry)

*It will first try to download each track from Deezer and only if it fails, will grab it from Spotify
**Only for spotify. For each track, it matches its length with the time it takes to download it
***Restrictions per account tier apply (see 

## Prerequisites

- Docker, duh
- Spotify credentials (see [Spotify Credentials Setup](#spotify-credentials-setup))
- Spotify client ID and client secret (see [Spotify Developer Setup](#spotify-developer-setup))
- Deezer ARL token (see [Deezer ARL Setup](#deezer-arl-setup))

## Installation

1. Create project directory:
```bash
mkdir spotizerr && cd spotizerr
```

2. Copy the `.env` file from this repo and update all variables (e.g. Redis credentials, PUID/PGID, UMASK).
3. Copy `docker-compose.yml` from this repo.
4. Create required directories:
```bash
mkdir -p creds config downloads logs cache
```
5. Launch containers:
```bash
docker compose up -d
```
_Note: an UnRaid template is available in the file spotizerr.xml_

Access at: `http://localhost:7171`

## Configuration

### Initial Setup
1. Access settings via the gear icon
2. Switch between service tabs (Spotify/Deezer)
3. Enter credentials using the form
4. Configure active accounts in settings

_Note: If you want Spotify-only mode, just keep "Download fallback" setting disabled and don't bother adding Deezer credentials. Deezer-only mode is not, and will not be supported since there already is a much better tool for that called "Deemix"_

### Spotify Credentials Setup

First create a Spotify credentials file using the 3rd-party `librespot-auth` tool, this step has to be done in a PC/Laptop that has the Spotify desktop app installed.

---
#### For Linux (using Docker)
1. Clone the `librespot-auth` repository:  
   ```shell
   git clone --depth 1 https://github.com/dspearson/librespot-auth.git
   ```

2. Build the repository using the Rust Docker image:  
   ```shell
   docker run --rm -v "$(pwd)/librespot-auth":/app -w /app rust:latest cargo build --release
   ```

3. Run the built binary:    
     ```shell
     ./librespot-auth/target/release/librespot-auth --name "mySpotifyAccount1" --class=computer
     ```

---

#### For Windows (using Docker)

1. Clone the `librespot-auth` repository:  
   ```shell
   git clone --depth 1 https://github.com/dspearson/librespot-auth.git
   ```

2. Build the repository using a windows-targeted Rust Docker image ([why a different image?](https://github.com/jscharnitzke/rust-build-windows)):  
   ```shell
   docker run --rm -v "${pwd}/librespot-auth:/app" -w "/app" jscharnitzke/rust-build-windows --release
   ```

3. Run the built binary:   
     ```shell
     .\librespot-auth\target\x86_64-pc-windows-gnu\release\librespot-auth.exe --name "mySpotifyAccount1" --class=computer
     ```
---

#### For Apple Silicon (macOS)
1. Clone the `librespot-auth` repository:  
   ```shell
   git clone --depth 1 https://github.com/dspearson/librespot-auth.git
   ```

2. Install Rust using Homebrew:  
   ```shell
   brew install rustup
   brew install rust
   ```

3. Build `librespot-auth` for Apple Silicon:  
   ```shell
   cd librespot-auth
   cargo build --target=aarch64-apple-darwin --release
   ```

4. Run the built binary:  
   ```shell
   ./target/aarch64-apple-darwin/release/librespot-auth --name "mySpotifyAccount1" --class=computer
   ```
---

- Now open the Spotify app
- Click on the "Connect to a device" icon
- Under the "Select Another Device" section, click "mySpotifyAccount1"
- This utility will create a `credentials.json` file

This file has the following format:

```
{"username": "string" "auth_type": 1 "auth_data": "string"}
```

The important ones are the "username" and "auth_data" parameters, these match the "username" and "credentials" sections respectively when adding/editing spotify credentials in Spotizerr.

In the terminal, you can directly print these parameters using jq:

```
jq -r '.username, .auth_data' credentials.json
```

### Spotify Developer Setup

In order for searching to work, you need to set up your own Spotify Developer application:

1. Visit the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/)
2. Log in with your Spotify account
3. Click "Create app"
4. Fill in:
   - App name (e.g., "My Spotizerr App")
   - App description
   - Redirect URI: `http://127.0.0.1:7171/callback` (or your custom domain if exposed)
   - Check the Developer Terms agreement box
5. Click "Create"
6. On your app page, note your "Client ID" 
7. Click "Show client secret" to reveal your "Client Secret"
8. Add these credentials in Spotizerr's settings page under the Spotify service section

### Deezer ARL Setup

#### Chrome-based browsers

Open the [web player](https://www.deezer.com/)

There, press F12 and select "Application"

![image](https://github.com/user-attachments/assets/22e61d91-50b4-48f2-bba7-28ef45b45ee5)

Expand Cookies section and select the "https://www.deezer.com". Find the "arl" cookie and double-click the "Cookie Value" tab's text.

![image](https://github.com/user-attachments/assets/75a67906-596e-42a0-beb0-540f2748b16e)

Copy that value and paste it into the correspondant setting in Spotizerr

#### Firefox-based browsers

Open the [web player](https://www.deezer.com/)

There, press F12 and select "Storage"

![image](https://github.com/user-attachments/assets/601be3fb-1ec9-44d9-be4f-28b1d853df2f)

Click the cookies host "https://www.deezer.com" and find the "arl" cookie.

![image](https://github.com/user-attachments/assets/ef8ea256-2c13-4780-ae9f-71527466df56)

Copy that value and paste it into the correspondant setting in Spotizerr

## Usage

### Basic Operations
1. **Search**:
   - Enter query in search bar
   - Select result type (Track/Album/Playlist/Artist)
   - Click search button or press Enter

2. **Download**:
   - Click download button on any result
      - For artists, you can select a specific subset of albums you want to download
   - Monitor progress in queue sidebar

3. **Direct URLs**:
   - Paste Spotify URLs directly into search
   - Supports tracks, albums, playlists and artists (this will download the whole discogrpahy, you've been warned)

### Advanced Features
- **Fallback System**:
  - Enable in settings
  - Uses Deezer as primary when downloading with Spotify fallback

- **Multiple Accounts**:
  - Manage credentials in settings
  - Switch active accounts per service
    
- **Quality selector**
   - For spotify: OGG 96k, 160k and 320k (premium only)
   - For deezer: MP3 128k, MP3 320k (sometimes premium, it varies) and FLAC (premium only)

- **Customizable formatting**:
  - Track number padding (01. Track or 1. Track)
  - Adjust retry parameters (max attempts, delay, delay increase)

### Environment Variables

Define your variables in the `.env` file in the project root:
```dotenv
REDIS_HOST=redis             # Redis host name
REDIS_PORT=6379              # Redis port number
REDIS_DB=0                   # Redis DB index
REDIS_PASSWORD=CHANGE_ME     # Redis AUTH password
EXPLICIT_FILTER=false        # Filter explicit content
PUID=1000                    # Container user ID
PGID=1000                    # Container group ID
UMASK=0022                   # Default file permission mask
```

## Troubleshooting

**Common Issues**:
- "No accounts available" error: Add credentials in settings
- Download failures: Check credential validity
- Queue stalls: Verify service connectivity
- Audiokey related: Spotify rate limit, let it cooldown about 30 seconds and click retry
- API errors: Ensure your Spotify client ID and client secret are correctly entered

**Log Locations**:
- Credentials: `./creds/` directory
- Downloads: `./downloads/` directory
- Application logs: `docker logs spotizerr`

## Notes

- This app has no way of authentication, if you plan on exposing it, put a security layer on top of it (such as cloudflare tunnel, authelia or just leave it accessible only through a vpn)
- Credentials are stored in plaintext - secure your installation
- Downloaded files retain original metadata
- Service limitations apply based on account types

# Acknowledgements

- This project is based on the amazing [deezspot library](https://github.com/jakiepari/deezspot), although their creators are in no way related with Spotizerr, they still deserve credit
