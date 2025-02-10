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
      showError('Error loading track');
    });

  // Attach event listener to the queue icon to toggle the download queue
  const queueIcon = document.getElementById('queueIcon');
  if (queueIcon) {
    queueIcon.addEventListener('click', () => {
      downloadQueue.toggleVisibility();
    });
  }
});

/**
 * Renders the track header information.
 */
function renderTrack(track) {
  // Hide the loading and error messages.
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');

  // Update track information fields.
  document.getElementById('track-name').innerHTML =
    `<a href="/track/${track.id}" title="View track details">${track.name}</a>`;
    
  document.getElementById('track-artist').innerHTML =
    `By ${track.artists.map(a =>
      `<a href="/artist/${a.id}" title="View artist details">${a.name}</a>`
    ).join(', ')}`;
    
  document.getElementById('track-album').innerHTML =
    `Album: <a href="/album/${track.album.id}" title="View album details">${track.album.name}</a> (${track.album.album_type})`;
    
  document.getElementById('track-duration').textContent =
    `Duration: ${msToTime(track.duration_ms)}`;
    
  document.getElementById('track-explicit').textContent =
    track.explicit ? 'Explicit' : 'Clean';

  const imageUrl = (track.album.images && track.album.images[0])
    ? track.album.images[0].url
    : 'placeholder.jpg';
  document.getElementById('track-album-image').src = imageUrl;

  // --- Insert Home Button (if not already present) ---
  let homeButton = document.getElementById('homeButton');
  if (!homeButton) {
    homeButton = document.createElement('button');
    homeButton.id = 'homeButton';
    homeButton.className = 'home-btn';
    homeButton.innerHTML = `<img src="/static/images/home.svg" alt="Home" />`;
    // Prepend the home button into the header.
    document.getElementById('track-header').insertBefore(homeButton, document.getElementById('track-header').firstChild);
  }
  homeButton.addEventListener('click', () => {
    window.location.href = window.location.origin;
  });

  // --- Move the Download Button from #actions into #track-header ---
  let downloadBtn = document.getElementById('downloadTrackBtn');
  if (downloadBtn) {
    // Remove the parent container (#actions) if needed.
    const actionsContainer = document.getElementById('actions');
    if (actionsContainer) {
      actionsContainer.parentNode.removeChild(actionsContainer);
    }
    // Set the inner HTML to use the download.svg icon.
    downloadBtn.innerHTML = `<img src="/static/images/download.svg" alt="Download">`;
    // Append the download button to the track header so it appears at the right.
    document.getElementById('track-header').appendChild(downloadBtn);
  }

  downloadBtn.addEventListener('click', () => {
    downloadBtn.disabled = true;
    downloadBtn.innerHTML = `<span>Queueing...</span>`;
    
    downloadQueue.startTrackDownload(track.external_urls.spotify, { name: track.name })
      .then(() => {
        downloadBtn.innerHTML = `<span>Queued!</span>`;
      })
      .catch(err => {
        showError('Failed to queue track download: ' + err.message);
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = `<img src="/static/images/download.svg" alt="Download">`;
      });
  });

  // Reveal the header now that track info is loaded.
  document.getElementById('track-header').classList.remove('hidden');
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
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }
}

/**
 * Starts the download process by building the API URL,
 * fetching download details, and then adding the download to the queue.
 */
async function startDownload(url, type, item) {
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
  let apiUrl = `/api/${type}/download?service=${service}&url=${encodeURIComponent(url)}`;

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

  // Append custom formatting parameters if they are set.
  if (customTrackFormat) {
    apiUrl += `&custom_track_format=${encodeURIComponent(customTrackFormat)}`;
  }
  if (customDirFormat) {
    apiUrl += `&custom_dir_format=${encodeURIComponent(customDirFormat)}`;
  }

  try {
    const response = await fetch(apiUrl);
    const data = await response.json();
    downloadQueue.addDownload(item, type, data.prg_file);
  } catch (error) {
    showError('Download failed: ' + error.message);
    throw error;
  }
}
