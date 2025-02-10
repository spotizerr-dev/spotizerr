// Import the downloadQueue singleton from your working queue.js implementation.
import { downloadQueue } from './queue.js';

document.addEventListener('DOMContentLoaded', () => {
  // Parse playlist ID from URL
  const pathSegments = window.location.pathname.split('/');
  const playlistId = pathSegments[pathSegments.indexOf('playlist') + 1];

  if (!playlistId) {
    showError('No playlist ID provided.');
    return;
  }

  // Fetch playlist info and render it
  fetch(`/api/playlist/info?id=${encodeURIComponent(playlistId)}`)
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok');
      return response.json();
    })
    .then(data => renderPlaylist(data))
    .catch(error => {
      console.error('Error:', error);
      showError('Failed to load playlist.');
    });

  const queueIcon = document.getElementById('queueIcon');
  if (queueIcon) {
    queueIcon.addEventListener('click', () => {
      downloadQueue.toggleVisibility();
    });
  }
});

/**
 * Renders playlist header and tracks.
 */
function renderPlaylist(playlist) {
  // Hide loading and error messages
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');

  // Update header info
  document.getElementById('playlist-name').textContent = playlist.name;
  document.getElementById('playlist-owner').textContent = `By ${playlist.owner.display_name}`;
  document.getElementById('playlist-stats').textContent =
    `${playlist.followers.total} followers • ${playlist.tracks.total} songs`;
  document.getElementById('playlist-description').textContent = playlist.description;
  const image = playlist.images[0]?.url || 'placeholder.jpg';
  document.getElementById('playlist-image').src = image;

  // --- Add Home Button ---
  let homeButton = document.getElementById('homeButton');
  if (!homeButton) {
    homeButton = document.createElement('button');
    homeButton.id = 'homeButton';
    homeButton.className = 'home-btn';
    // Use an <img> tag to display the SVG icon.
    homeButton.innerHTML = `<img src="/static/images/home.svg" alt="Home">`;
    // Insert the home button at the beginning of the header container.
    const headerContainer = document.getElementById('playlist-header');
    headerContainer.insertBefore(homeButton, headerContainer.firstChild);
  }
  homeButton.addEventListener('click', () => {
    // Navigate to the site's base URL.
    window.location.href = window.location.origin;
  });

  // --- Add "Download Whole Playlist" Button ---
  let downloadPlaylistBtn = document.getElementById('downloadPlaylistBtn');
  if (!downloadPlaylistBtn) {
    downloadPlaylistBtn = document.createElement('button');
    downloadPlaylistBtn.id = 'downloadPlaylistBtn';
    downloadPlaylistBtn.textContent = 'Download Whole Playlist';
    downloadPlaylistBtn.className = 'download-btn download-btn--main';
    // Insert the button into the header container.
    const headerContainer = document.getElementById('playlist-header');
    headerContainer.appendChild(downloadPlaylistBtn);
  }
  downloadPlaylistBtn.addEventListener('click', () => {
    // Remove individual track download buttons (but leave the whole playlist button).
    document.querySelectorAll('.download-btn').forEach(btn => {
      if (btn.id !== 'downloadPlaylistBtn') {
        btn.remove();
      }
    });

    // Disable the whole playlist button to prevent repeated clicks.
    downloadPlaylistBtn.disabled = true;
    downloadPlaylistBtn.textContent = 'Queueing...';

    // Initiate the playlist download.
    downloadWholePlaylist(playlist).then(() => {
      downloadPlaylistBtn.textContent = 'Queued!';
    }).catch(err => {
      showError('Failed to queue playlist download: ' + err.message);
      downloadPlaylistBtn.disabled = false;
    });
  });

  // --- Add "Download Playlist's Albums" Button ---
  let downloadAlbumsBtn = document.getElementById('downloadAlbumsBtn');
  if (!downloadAlbumsBtn) {
    downloadAlbumsBtn = document.createElement('button');
    downloadAlbumsBtn.id = 'downloadAlbumsBtn';
    downloadAlbumsBtn.textContent = "Download Playlist's Albums";
    downloadAlbumsBtn.className = 'download-btn download-btn--main';
    // Insert the new button into the header container.
    const headerContainer = document.getElementById('playlist-header');
    headerContainer.appendChild(downloadAlbumsBtn);
  }
  downloadAlbumsBtn.addEventListener('click', () => {
    // Remove individual track download buttons (but leave this album button).
    document.querySelectorAll('.download-btn').forEach(btn => {
      if (btn.id !== 'downloadAlbumsBtn') btn.remove();
    });

    downloadAlbumsBtn.disabled = true;
    downloadAlbumsBtn.textContent = 'Queueing...';

    downloadPlaylistAlbums(playlist)
      .then(() => {
        downloadAlbumsBtn.textContent = 'Queued!';
      })
      .catch(err => {
        showError('Failed to queue album downloads: ' + err.message);
        downloadAlbumsBtn.disabled = false;
      });
  });

  // Render tracks list
  const tracksList = document.getElementById('tracks-list');
  tracksList.innerHTML = ''; // Clear any existing content

  playlist.tracks.items.forEach((item, index) => {
    const track = item.track;
    // Create links for track, artist, and album using their IDs.
    const trackLink = `/track/${track.id}`;
    const artistLink = `/artist/${track.artists[0].id}`;
    const albumLink = `/album/${track.album.id}`;

    const trackElement = document.createElement('div');
    trackElement.className = 'track';
    trackElement.innerHTML = `
      <div class="track-number">${index + 1}</div>
      <div class="track-info">
        <div class="track-name">
          <a href="${trackLink}" title="View track details">${track.name}</a>
        </div>
        <div class="track-artist">
          <a href="${artistLink}" title="View artist details">${track.artists[0].name}</a>
        </div>
      </div>
      <div class="track-album">
        <a href="${albumLink}" title="View album details">${track.album.name}</a>
      </div>
      <div class="track-duration">${msToTime(track.duration_ms)}</div>
      <button class="download-btn download-btn--circle" 
              data-url="${track.external_urls.spotify}" 
              data-type="track"
              data-name="${track.name}"
              title="Download">
        <img src="/static/images/download.svg" alt="Download">
      </button>
    `;
    tracksList.appendChild(trackElement);
  });

  // Reveal header and tracks container
  document.getElementById('playlist-header').classList.remove('hidden');
  document.getElementById('tracks-container').classList.remove('hidden');

  // Attach download listeners to newly rendered download buttons
  attachDownloadListeners();
}

/**
 * Converts milliseconds to minutes:seconds.
 */
function msToTime(duration) {
  const minutes = Math.floor(duration / 60000);
  const seconds = ((duration % 60000) / 1000).toFixed(0);
  return `${minutes}:${seconds.padStart(2, '0')}`;
}

/**
 * Displays an error message in the UI.
 */
function showError(message) {
  const errorEl = document.getElementById('error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

/**
 * Attaches event listeners to all individual download buttons.
 */
function attachDownloadListeners() {
  document.querySelectorAll('.download-btn').forEach((btn) => {
    // Skip the whole playlist and album download buttons.
    if (btn.id === 'downloadPlaylistBtn' || btn.id === 'downloadAlbumsBtn') return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = e.currentTarget.dataset.url;
      const type = e.currentTarget.dataset.type;
      const name = e.currentTarget.dataset.name || extractName(url);
      // Remove the button immediately after click.
      e.currentTarget.remove();
      startDownload(url, type, { name });
    });
  });
}

/**
 * Initiates the whole playlist download by calling the playlist endpoint.
 */
async function downloadWholePlaylist(playlist) {
  const url = playlist.external_urls.spotify;
  try {
    await downloadQueue.startPlaylistDownload(url, { name: playlist.name });
  } catch (error) {
    showError('Playlist download failed: ' + error.message);
    throw error;
  }
}

/**
 * Initiates album downloads for each unique album in the playlist,
 * adding a 20ms delay between each album download and updating the button
 * with the progress (queued_albums/total_albums).
 */
async function downloadPlaylistAlbums(playlist) {
  // Build a map of unique albums (using album ID as the key).
  const albumMap = new Map();
  playlist.tracks.items.forEach(item => {
    const album = item.track.album;
    if (album && album.id) {
      albumMap.set(album.id, album);
    }
  });

  const uniqueAlbums = Array.from(albumMap.values());
  const totalAlbums = uniqueAlbums.length;
  if (totalAlbums === 0) {
    showError('No albums found in this playlist.');
    return;
  }

  // Get a reference to the "Download Playlist's Albums" button.
  const downloadAlbumsBtn = document.getElementById('downloadAlbumsBtn');
  if (downloadAlbumsBtn) {
    // Initialize the progress display.
    downloadAlbumsBtn.textContent = `0/${totalAlbums}`;
  }

  try {
    // Process each album sequentially.
    for (let i = 0; i < totalAlbums; i++) {
      const album = uniqueAlbums[i];
      await downloadQueue.startAlbumDownload(
        album.external_urls.spotify,
        { name: album.name }
      );

      // Update button text with current progress.
      if (downloadAlbumsBtn) {
        downloadAlbumsBtn.textContent = `${i + 1}/${totalAlbums}`;
      }

      // Wait 20 milliseconds before processing the next album.
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    // Once all albums have been queued, update the button text.
    if (downloadAlbumsBtn) {
      downloadAlbumsBtn.textContent = 'Queued!';
    }
  } catch (error) {
    // Propagate any errors encountered.
    throw error;
  }
}



/**
 * Starts the download process by building the API URL,
 * fetching download details, and then adding the download to the queue.
 */
async function startDownload(url, type, item, albumType) {
  // Retrieve configuration (if any) from localStorage.
  const config = JSON.parse(localStorage.getItem('activeConfig')) || {};
  const {
    fallback = false,
    spotify = '',
    deezer = '',
    spotifyQuality = 'NORMAL',
    deezerQuality = 'MP3_128',
    realTime = false,
    customTrackFormat = '',
    customDirFormat = ''
  } = config;

  const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
  let apiUrl = '';

  // Build API URL based on the download type.
  if (type === 'playlist') {
    // Use the dedicated playlist download endpoint.
    apiUrl = `/api/playlist/download?service=${service}&url=${encodeURIComponent(url)}`;
  } else if (type === 'artist') {
    apiUrl = `/api/artist/download?service=${service}&artist_url=${encodeURIComponent(url)}&album_type=${encodeURIComponent(albumType || 'album,single,compilation')}`;
  } else {
    // Default is track download.
    apiUrl = `/api/${type}/download?service=${service}&url=${encodeURIComponent(url)}`;
  }

  // Append account and quality details.
  if (fallback && service === 'spotify') {
    apiUrl += `&main=${deezer}&fallback=${spotify}`;
    apiUrl += `&quality=${deezerQuality}&fall_quality=${spotifyQuality}`;
  } else {
    const mainAccount = service === 'spotify' ? spotify : deezer;
    apiUrl += `&main=${mainAccount}&quality=${service === 'spotify' ? spotifyQuality : deezerQuality}`;
  }

  if (realTime) {
    apiUrl += '&real_time=true';
  }

  // Append custom formatting parameters.
  if (customTrackFormat) {
    apiUrl += `&custom_track_format=${encodeURIComponent(customTrackFormat)}`;
  }
  if (customDirFormat) {
    apiUrl += `&custom_dir_format=${encodeURIComponent(customDirFormat)}`;
  }

  try {
    const response = await fetch(apiUrl);
    const data = await response.json();
    // Add the download to the queue using the working queue implementation.
    downloadQueue.addDownload(item, type, data.prg_file);
  } catch (error) {
    showError('Download failed: ' + error.message);
  }
}

/**
 * A helper function to extract a display name from the URL.
 */
function extractName(url) {
  return url;
}
