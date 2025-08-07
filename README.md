# SUPPORT YOUR ARTISTS

As of 2025, Spotify pays an average of $0.005 per stream to the artist. That means that if you give the equivalent of $5 directly to them (like merch, buying CDs, or just donating), you can """ethically""" listen to them a total of 1000 times. Of course, nobody thinks Spotify payment is fair, so preferably you should give more, but $5 is the bare minimum. Big names probably don't need those $5 dollars, but it might be _the_ difference between going out of business or not for that indie rock band you like.

# Spotizerr

A self-hosted music download manager with a lossless twist. Download everything from Spotify, and if it happens to also be on Deezer, download from there so you get those tasty FLACs.

## Why?

If you self-host a music server with other users than yourself, you almost certainly have realized that the process of adding requested items to the library is not without its friction; no matter how automated your flow is, unless your users are tech-savvy enough to do it themselves, chances are the process always needs some type of manual intervention from you, be it to rip the CDs yourself, tag some random files from youtube, etc. Well, no more! Spotizerr allows for your users to access a nice little frontend where they can add whatever they want to the library without bothering you. What's that? You want some screenshots? Sure, why not:

<details>
  <summary>Main page</summary>
  <img src="" alt="Hidden image">
</details>

## ✨ Key Features

### 🎵 **Granular download support**
- **Individual Tracks** - Download any single track
- **Complete Albums** - Download entire albums with proper metadata
- **Full Playlists** - Download complete playlists (even massive ones with 1000+ tracks)
- **Artist Discographies** - Download an artist's complete catalog with filtering options
- **Spotify URL Support** - Paste any Spotify URL directly to queue downloads

### 📱 **Modern Web Interface**
- **Progressive Web App (PWA)** - Install as a native client on mobile/desktop
- **Real-time Progress Tracking** - Live download progress with bandwidth and ETA
- **Responsive Design** - Optimized for both mobile and desktop use
- **Multiple Themes** - Light, dark, and system themes
- **Touch-friendly** - Swipe gestures and mobile-optimized controls

### 🤖 **Intelligent Monitoring**
- **Playlist Watching** - Automatically download new tracks added to playlists
- **Artist Watching** - Monitor artists for new releases and download them automatically
- **Smart Change Detection** - Only processes new content using Spotify's snapshot system
- **Configurable Intervals** - Set how often to check for updates
- **Manual Triggers** - Force immediate checks when needed

### ⚡ **Advanced Queue Management**
- **Concurrent Downloads** - Configure multiple simultaneous downloads
- **Real-time Updates** - Live progress updates via Server-Sent Events
- **Duplicate Prevention** - Automatically prevents duplicate downloads
- **Queue Persistence** - Downloads continue even after browser restart
- **Cancellation Support** - Cancel individual downloads or clear entire queue

### 🔧 **Extensive Configuration**
- **Multiple Services** - Support for both Spotify and Deezer premium accounts
- **Quality Control** - Configure audio quality per service
- **Format Options** - Convert to MP3, FLAC, AAC, OGG, OPUS, WAV, ALAC
- **Custom Naming** - Flexible file and folder naming patterns
- **Fallback System** - Use alternative service if primary fails
- **Content Filtering** - Hide explicit content if desired

### 📊 **Comprehensive History**
- **Download Tracking** - Complete history of all downloads with metadata
- **Success Analytics** - Track success rates, failures, and skipped items
- **Search & Filter** - Find past downloads by title, artist, or status
- **Detailed Logs** - View individual track status for album/playlist downloads
- **Export Data** - Access complete metadata and external service IDs

### 👥 **Multi-User Support**
- **User Authentication** - Secure login system with JWT tokens
- **Role-Based Access** - Admin and regular user roles
- **SSO Integration** - Single Sign-On with Google and GitHub
- **Admin Panel** - User management and system configuration
- **Individual Profiles** - Personal settings and download history per user

### 🔒 **Security & Privacy**
- **Self-Hosted** - Your data stays on your server
- **Encrypted Credentials** - Secure storage of service accounts
- **Access Control** - Granular permissions and admin-only features
- **Session Management** - Secure token handling with configurable expiration
- **HTTPS Ready** - Full HTTPS support for production deployment

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose
- Spotify Premium account(s)
- Deezer Premium account(s) (optional)
- Spotify API credentials (Client ID & Secret from Spotify Developer Dashboard)

### Installation

1. **Create project directory**
   ```bash
   mkdir spotizerr && cd spotizerr
   ```

2. **Setup environment file**
   ```bash
   # Download .env.example from the repository and create .env
   # Update all variables (e.g. Redis credentials, PUID/PGID, UMASK)
   ```

3. **Copy docker-compose.yml**
   ```bash
   # Download docker-compose.yml from the repository
   ```

4. **Start the application**
   ```bash
   docker compose up -d
   ```

5. **Access the interface**
   - Open `http://localhost:7171` in your browser
   - Complete initial setup and add your service accounts

_Note: An UnRAID template is available in the file spotizerr.xml_

### Environment Variables

```bash
# Authentication (optional but recommended)
ENABLE_AUTH=true
DISABLE_REGISTRATION=false
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# SSO (optional)
SSO_ENABLED=true
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Default admin (when auth is enabled)
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=admin123

# Content filtering
EXPLICIT_FILTER=false

# Frontend URL (for SSO redirects)
FRONTEND_URL=http://localhost:7171
```

## 🔧 Configuration

### Service Accounts Setup

1. **Add Spotify API Credentials**
   - Go to Settings → Server → Spotify API Configuration
   - Add your Spotify Client ID and Secret

2. **Add Spotify Premium Accounts**
   - Navigate to Settings → Accounts
   - Add your Spotify Premium credentials
   - **Important**: Spotify is very restrictive, so use the [spotizerr-auth](https://github.com/Xoconoch/spotizerr-auth) tool to simplify this setup

3. **Add Deezer Premium Accounts (Optional)**
   - Get your Deezer ARL token:
     - **Chrome/Edge**: Open [Deezer](https://www.deezer.com/), press F12 → Application → Cookies → "https://www.deezer.com" → Copy "arl" value
     - **Firefox**: Open [Deezer](https://www.deezer.com/), press F12 → Storage → Cookies → "https://www.deezer.com" → Copy "arl" value
   - Add the ARL token in Settings → Accounts

4. **Configure Download Settings**
   - Set audio quality preferences
   - Configure output format and naming
   - Adjust concurrent download limits

### Watch System Setup

1. **Enable Monitoring**
   - Go to Settings → Watch
   - Enable the watch system
   - Set check intervals

2. **Add Items to Watch**
   - Search for playlists or artists
   - Click the "Watch" button
   - New content will be automatically downloaded

## 📋 Usage Examples

### Download a Playlist
1. Search for the playlist or paste its Spotify URL
2. Click the download button
3. Monitor progress in the real-time queue

### Monitor an Artist
1. Search for the artist
2. Click "Add to Watchlist" 
3. Configure which release types to monitor (albums, singles, etc.)
4. New releases will be automatically downloaded

### Bulk Download an Artist's Discography
1. Go to the artist page
2. Select release types (albums, singles, compilations)
3. Click "Download Discography"
4. All albums will be queued automatically

## 🔍 Advanced Features

### Custom File Naming
Configure how files and folders are named:
- `%artist%/%album%/%tracknum%. %title%`
- `%ar_album%/%album% (%year%)/%title%`
- Support for track numbers, artists, albums, years, and more

### Quality Settings
- **Spotify**: OGG 96k, 160k, and 320k (320k requires Premium)
- **Deezer**: MP3 128k, MP3 320k (sometimes requires Premium), and FLAC (Premium only)
- **Conversion**: Convert to any supported format with custom bitrate

### Fallback System
- Configure primary and fallback services
- Automatically switches if primary service fails
- Useful for geographic restrictions or account limits

### Real-time Mode
- **Spotify only**: Matches track length with download time for optimal timing


## 📊 System Requirements

### Minimum
- 1 CPU core
- 512MB RAM
- 10GB storage space
- Docker support

### Recommended
- 2+ CPU cores
- 2GB+ RAM
- 50GB+ storage space
- SSD for better performance

## 🆘 Support & Troubleshooting

### Common Issues

**Downloads not starting?**
- Check that service accounts are configured correctly
- Verify API credentials are valid
- Ensure sufficient storage space
- "No accounts available" error: Add credentials in settings

**Download failures?**
- Check credential validity and account status
- Audiokey related errors: Spotify rate limit, wait ~30 seconds and retry
- API errors: Ensure Spotify Client ID and Secret are correct

**Watch system not working?**
- Enable the watch system in settings
- Check watch intervals aren't too frequent
- Verify items are properly added to watchlist

**Authentication problems?**
- Check JWT secret is set
- Verify SSO credentials if using
- Clear browser cache and cookies

**Queue stalling?**
- Verify service connectivity
- Check for network issues

### Logs
Access logs via Docker:
```bash
docker logs spotizerr
```

**Log Locations:**
- Application Logs: `docker logs spotizerr` (main app and Celery workers)
- Individual Task Logs: `./logs/tasks/` (inside container, maps to your volume)
- Credentials: `./data/creds/`
- Configuration Files: `./data/config/`
- Downloaded Music: `./downloads/`
- Watch Feature Database: `./data/watch/`
- Download History Database: `./data/history/`
- Spotify Token Cache: `./.cache/` (if `SPOTIPY_CACHE_PATH` is mapped)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

This project is licensed under the GPL yada yada, see [LICENSE](LICENSE) file for details.

## ⚠️ Important Notes

- **Credentials stored in plaintext** - Secure your installation appropriately
- **Service limitations apply** - Account tier restrictions and geographic limitations

### Legal Disclaimer
This software is for educational purposes and personal use only. Ensure you comply with the terms of service of Spotify, Deezer, and any other services you use. Respect copyright laws and only download content you have the right to access.

### File Handling
- Downloaded files retain original metadata
- Service limitations apply based on account types

## 🙏 Acknowledgements

This project was inspired by the amazing [deezspot library](https://github.com/jakiepari/deezspot). Although their creators are in no way related to Spotizerr, they still deserve credit for their excellent work. 
