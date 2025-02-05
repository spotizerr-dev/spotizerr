// Import the downloadQueue singleton from your working queue.js implementation.
import { downloadQueue } from './queue.js';

document.addEventListener('DOMContentLoaded', () => {
  // Parse track ID from URL. Expecting URL in the form /track/{id}
  const pathSegments = window.location.pathname.split('/');
  const trackId = pathSegments[pathSegments.indexOf('track') + 1];

  if (!trackId) {
    showError('No track ID provided.');
    return;
  }

  // Fetch track info and render it
  fetch(`/api/track/info?id=${encodeURIComponent(trackId)}`)
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok');
      return response.json();
    })
    .then(data => renderTrack(data))
    .catch(error => {
      console.error('Error:', error);
      showError('Failed to load track.');
    });

  // Attach event listener to the queue icon to toggle download queue
  const queueIcon = document.getElementById('queueIcon');
  if (queueIcon) {
    queueIcon.addEventListener('click', () => {
      downloadQueue.toggleVisibility();
    });
  }
});

/**
 * Renders the track header information.
 * The API response structure is assumed to be similar to:
 * {
 *    "album": { ... },
 *    "artists": [ ... ],
 *    "duration_ms": 149693,
 *    "explicit": false,
 *    "external_urls": { "spotify": "https://open.spotify.com/track/..." },
 *    "name": "Track Name",
 *    ... other track info
 * }
 */
function renderTrack(track) {
  // Hide loading and error messages
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');

  // Update header info
  document.getElementById('track-name').textContent = track.name;
  // Display the first artist’s name (or join multiple if needed)
  document.getElementById('track-artist').textContent = `By ${track.artists.map(a => a.name).join(', ')}`;
  // Display album name and type
  document.getElementById('track-album').textContent = `Album: ${track.album.name} (${track.album.album_type})`;
  // Display track duration converted from milliseconds
  document.getElementById('track-duration').textContent = `Duration: ${msToTime(track.duration_ms)}`;
  // Show if the track is explicit
  document.getElementById('track-explicit').textContent = track.explicit ? 'Explicit' : 'Clean';

  // Use the album cover image if available; otherwise, fall back to a placeholder
  const imageUrl = track.album.images && track.album.images[0] ? track.album.images[0].url : 'placeholder.jpg';
  document.getElementById('track-album-image').src = imageUrl;

  // --- Add Back Button (if not already added) ---
  let backButton = document.getElementById('backButton');
  if (!backButton) {
    backButton = document.createElement('button');
    backButton.id = 'backButton';
    backButton.textContent = 'Back';
    backButton.className = 'back-btn';
    // Insert the back button at the beginning of the header container.
    const headerContainer = document.getElementById('track-header');
    headerContainer.insertBefore(backButton, headerContainer.firstChild);
  }
  backButton.addEventListener('click', () => {
    // Navigate to the site's base URL.
    window.location.href = window.location.origin;
  });

  // --- Attach Download Button Listener ---
  const downloadBtn = document.getElementById('downloadTrackBtn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      // Disable the button to prevent repeated clicks.
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Queueing...';

      // Start the download for the track.
      startDownload(track.external_urls.spotify, 'track', { name: track.name })
        .then(() => {
          downloadBtn.textContent = 'Queued!';
        })
        .catch(err => {
          showError('Failed to queue track download: ' + err.message);
          downloadBtn.disabled = false;
        });
    });
  }

  // Reveal the header and actions container
  document.getElementById('track-header').classList.remove('hidden');
  document.getElementById('actions').classList.remove('hidden');
}

/**
 * Converts milliseconds to minutes:seconds.
 */
function msToTime(duration) {
  const minutes = Math.floor(duration / 60000);
  const seconds = Math.floor((duration % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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
 * Starts the download process by building the API URL,
 * fetching download details, and then adding the download to the queue.
 */
async function startDownload(url, type, item) {
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

  // For a track, we use the default track download endpoint.
  apiUrl = `/api/${type}/download?service=${service}&url=${encodeURIComponent(url)}`;

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
    throw error;
  }
}
