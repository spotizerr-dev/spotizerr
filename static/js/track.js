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

  // Fetch track info directly
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
    `<a href="/track/${track.id || ''}" title="View track details">${track.name || 'Unknown Track'}</a>`;
    
  document.getElementById('track-artist').innerHTML =
    `By ${track.artists?.map(a =>
      `<a href="/artist/${a?.id || ''}" title="View artist details">${a?.name || 'Unknown Artist'}</a>`
    ).join(', ') || 'Unknown Artist'}`;
    
  document.getElementById('track-album').innerHTML =
    `Album: <a href="/album/${track.album?.id || ''}" title="View album details">${track.album?.name || 'Unknown Album'}</a> (${track.album?.album_type || 'album'})`;
    
  document.getElementById('track-duration').textContent =
    `Duration: ${msToTime(track.duration_ms || 0)}`;
    
  document.getElementById('track-explicit').textContent =
    track.explicit ? 'Explicit' : 'Clean';

  const imageUrl = (track.album?.images && track.album.images[0])
    ? track.album.images[0].url
    : '/static/images/placeholder.jpg';
  document.getElementById('track-album-image').src = imageUrl;

  // --- Insert Home Button (if not already present) ---
  let homeButton = document.getElementById('homeButton');
  if (!homeButton) {
    homeButton = document.createElement('button');
    homeButton.id = 'homeButton';
    homeButton.className = 'home-btn';
    homeButton.innerHTML = `<img src="/static/images/home.svg" alt="Home" />`;
    // Prepend the home button into the header.
    const trackHeader = document.getElementById('track-header');
    if (trackHeader) {
      trackHeader.insertBefore(homeButton, trackHeader.firstChild);
    }
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
      actionsContainer.parentNode?.removeChild(actionsContainer);
    }
    // Set the inner HTML to use the download.svg icon.
    downloadBtn.innerHTML = `<img src="/static/images/download.svg" alt="Download">`;
    // Append the download button to the track header so it appears at the right.
    const trackHeader = document.getElementById('track-header');
    if (trackHeader) {
      trackHeader.appendChild(downloadBtn);
    }
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      downloadBtn.disabled = true;
      downloadBtn.innerHTML = `<span>Queueing...</span>`;
      
      const trackUrl = track.external_urls?.spotify || '';
      if (!trackUrl) {
        showError('Missing track URL');
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = `<img src="/static/images/download.svg" alt="Download">`;
        return;
      }
      
      // Create a local download function that uses our own API call instead of downloadQueue.startTrackDownload
      // This mirrors the approach used in main.js that works properly
      startDownload(trackUrl, 'track', { name: track.name || 'Unknown Track', artist: track.artists?.[0]?.name })
        .then(() => {
          downloadBtn.innerHTML = `<span>Queued!</span>`;
          // Make the queue visible to show the download
          downloadQueue.toggleVisibility(true);
        })
        .catch(err => {
          showError('Failed to queue track download: ' + (err?.message || 'Unknown error'));
          downloadBtn.disabled = false;
          downloadBtn.innerHTML = `<img src="/static/images/download.svg" alt="Download">`;
        });
    });
  }

  // Reveal the header now that track info is loaded.
  document.getElementById('track-header').classList.remove('hidden');
}

/**
 * Converts milliseconds to minutes:seconds.
 */
function msToTime(duration) {
  if (!duration || isNaN(duration)) return '0:00';
  
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
    errorEl.textContent = message || 'An error occurred';
    errorEl.classList.remove('hidden');
  }
}

/**
 * Starts the download process by building a minimal API URL with only the necessary parameters,
 * since the server will use config defaults for others.
 */
async function startDownload(url, type, item) {
  if (!url || !type) {
    showError('Missing URL or type for download');
    return;
  }
  
  const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
  let apiUrl = `/api/${type}/download?service=${service}&url=${encodeURIComponent(url)}`;

  // Add name and artist if available for better progress display
  if (item.name) {
    apiUrl += `&name=${encodeURIComponent(item.name)}`;
  }
  if (item.artist) {
    apiUrl += `&artist=${encodeURIComponent(item.artist)}`;
  }

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.prg_file) {
      throw new Error('Server did not return a valid PRG file');
    }
    
    // Add the download to the queue but don't start monitoring yet
    const queueId = downloadQueue.addDownload(item, type, data.prg_file, apiUrl, false);
    
    // Ensure the PRG file exists and has initial data by making a status check
    try {
      // Wait a short time before checking the status to give server time to create the file
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const statusResponse = await fetch(`/api/prgs/${data.prg_file}`);
      if (statusResponse.ok) {
        // Only start monitoring after confirming the PRG file exists
        const entry = downloadQueue.downloadQueue[queueId];
        if (entry) {
          // Start monitoring regardless of visibility
          downloadQueue.startEntryMonitoring(queueId);
        }
      }
    } catch (statusError) {
      console.log('Initial status check pending, will retry on next interval');
    }
  } catch (error) {
    showError('Download failed: ' + (error?.message || 'Unknown error'));
    throw error;
  }
}
