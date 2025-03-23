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

  // Check if track is explicit and if explicit filter is enabled
  if (track.explicit && downloadQueue.isExplicitFilterEnabled()) {
    // Show placeholder for explicit content
    document.getElementById('loading').classList.add('hidden');
    
    const placeholderContent = `
      <div class="explicit-filter-placeholder">
        <h2>Explicit Content Filtered</h2>
        <p>This track contains explicit content and has been filtered based on your settings.</p>
        <p>The explicit content filter is controlled by environment variables.</p>
      </div>
    `;
    
    const contentContainer = document.getElementById('track-header');
    if (contentContainer) {
      contentContainer.innerHTML = placeholderContent;
      contentContainer.classList.remove('hidden');
    }
    
    return; // Stop rendering the actual track content
  }

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
      
      // Use the centralized downloadQueue.download method
      downloadQueue.download(trackUrl, 'track', { name: track.name || 'Unknown Track', artist: track.artists?.[0]?.name })
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
 * Starts the download process by calling the centralized downloadQueue method
 */
async function startDownload(url, type, item) {
  if (!url || !type) {
    showError('Missing URL or type for download');
    return;
  }
  
  try {
    // Use the centralized downloadQueue.download method
    await downloadQueue.download(url, type, item);
    
    // Make the queue visible after queueing
    downloadQueue.toggleVisibility(true);
  } catch (error) {
    showError('Download failed: ' + (error?.message || 'Unknown error'));
    throw error;
  }
}
