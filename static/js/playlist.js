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

  // --- Add Back Button ---
  let backButton = document.getElementById('backButton');
  if (!backButton) {
    backButton = document.createElement('button');
    backButton.id = 'backButton';
    backButton.textContent = 'Back';
    backButton.className = 'back-btn';
    // Insert the back button at the beginning of the header container.
    const headerContainer = document.getElementById('playlist-header');
    headerContainer.insertBefore(backButton, headerContainer.firstChild);
  }
  backButton.addEventListener('click', () => {
    // Navigate to the site's base URL. For example, if the current URL is
    // cool.com/bla/bla, this will take you to cool.com.
    window.location.href = window.location.origin;
  });

  // --- Add "Download Whole Playlist" Button ---
  let downloadPlaylistBtn = document.getElementById('downloadPlaylistBtn');
  if (!downloadPlaylistBtn) {
    downloadPlaylistBtn = document.createElement('button');
    downloadPlaylistBtn.id = 'downloadPlaylistBtn';
    downloadPlaylistBtn.textContent = 'Download Whole Playlist';
    downloadPlaylistBtn.className = 'download-btn download-btn--main';
    // Insert the button into the header container (e.g. after the description)
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

  // Render tracks list
  const tracksList = document.getElementById('tracks-list');
  tracksList.innerHTML = ''; // Clear any existing content

  playlist.tracks.items.forEach((item, index) => {
    const track = item.track;
    // Create links for track, artist, and album using their IDs.
    // Ensure that track.id, track.artists[0].id, and track.album.id are available.
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
              data-name="${track.name}">
        Download
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
    // Skip the whole playlist button.
    if (btn.id === 'downloadPlaylistBtn') return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = e.currentTarget.dataset.url;
      const type = e.currentTarget.dataset.type;
      const name = e.currentTarget.dataset.name || extractName(url);
      const albumType = e.currentTarget.dataset.albumType;

      // Remove the button after click
      e.currentTarget.remove();

      // Start the download for this track.
      startDownload(url, type, { name }, albumType);
    });
  });
}

/**
 * Initiates the whole playlist download by calling the playlist endpoint.
 */
async function downloadWholePlaylist(playlist) {
  // Use the playlist external URL (assumed available) for the download.
  const url = playlist.external_urls.spotify;
  // Queue the whole playlist download with the descriptive playlist name.
  startDownload(url, 'playlist', { name: playlist.name });
}

/**
 * Starts the download process by building the API URL,
 * fetching download details, and then adding the download to the queue.
 */
async function startDownload(url, type, item, albumType) {
  // Retrieve configuration (if any) from localStorage
  const config = JSON.parse(localStorage.getItem('activeConfig')) || {};
  const {
    fallback = false,
    spotify = '',
    deezer = '',
    spotifyQuality = 'NORMAL',
    deezerQuality = 'MP3_128',
    realTime = false
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
