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

  // Fetch playlist info directly
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
  document.getElementById('playlist-name').textContent = playlist.name || 'Unknown Playlist';
  document.getElementById('playlist-owner').textContent = `By ${playlist.owner?.display_name || 'Unknown User'}`;
  document.getElementById('playlist-stats').textContent =
    `${playlist.followers?.total || '0'} followers • ${playlist.tracks?.total || '0'} songs`;
  document.getElementById('playlist-description').textContent = playlist.description || '';
  const image = playlist.images?.[0]?.url || '/static/images/placeholder.jpg';
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
    if (headerContainer) {
      headerContainer.insertBefore(homeButton, headerContainer.firstChild);
    }
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
    if (headerContainer) {
      headerContainer.appendChild(downloadPlaylistBtn);
    }
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
      showError('Failed to queue playlist download: ' + (err?.message || 'Unknown error'));
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
    if (headerContainer) {
      headerContainer.appendChild(downloadAlbumsBtn);
    }
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
        showError('Failed to queue album downloads: ' + (err?.message || 'Unknown error'));
        downloadAlbumsBtn.disabled = false;
      });
  });

  // Render tracks list
  const tracksList = document.getElementById('tracks-list');
  if (!tracksList) return;
  
  tracksList.innerHTML = ''; // Clear any existing content

  if (playlist.tracks?.items) {
    playlist.tracks.items.forEach((item, index) => {
      if (!item || !item.track) return; // Skip null/undefined tracks
      
      const track = item.track;
      // Create links for track, artist, and album using their IDs.
      const trackLink = `/track/${track.id || ''}`;
      const artistLink = `/artist/${track.artists?.[0]?.id || ''}`;
      const albumLink = `/album/${track.album?.id || ''}`;

      const trackElement = document.createElement('div');
      trackElement.className = 'track';
      trackElement.innerHTML = `
        <div class="track-number">${index + 1}</div>
        <div class="track-info">
          <div class="track-name">
            <a href="${trackLink}" title="View track details">${track.name || 'Unknown Track'}</a>
          </div>
          <div class="track-artist">
            <a href="${artistLink}" title="View artist details">${track.artists?.[0]?.name || 'Unknown Artist'}</a>
          </div>
        </div>
        <div class="track-album">
          <a href="${albumLink}" title="View album details">${track.album?.name || 'Unknown Album'}</a>
        </div>
        <div class="track-duration">${msToTime(track.duration_ms || 0)}</div>
        <button class="download-btn download-btn--circle" 
                data-url="${track.external_urls?.spotify || ''}" 
                data-type="track"
                data-name="${track.name || 'Unknown Track'}"
                title="Download">
          <img src="/static/images/download.svg" alt="Download">
        </button>
      `;
      tracksList.appendChild(trackElement);
    });
  }

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
  if (!duration || isNaN(duration)) return '0:00';
  
  const minutes = Math.floor(duration / 60000);
  const seconds = ((duration % 60000) / 1000).toFixed(0);
  return `${minutes}:${seconds.padStart(2, '0')}`;
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
 * Attaches event listeners to all individual download buttons.
 */
function attachDownloadListeners() {
  document.querySelectorAll('.download-btn').forEach((btn) => {
    // Skip the whole playlist and album download buttons.
    if (btn.id === 'downloadPlaylistBtn' || btn.id === 'downloadAlbumsBtn') return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = e.currentTarget.dataset.url || '';
      const type = e.currentTarget.dataset.type || '';
      const name = e.currentTarget.dataset.name || extractName(url) || 'Unknown';
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
  if (!playlist) {
    throw new Error('Invalid playlist data');
  }
  
  const url = playlist.external_urls?.spotify || '';
  if (!url) {
    throw new Error('Missing playlist URL');
  }
  
  try {
    // Use the centralized downloadQueue.download method
    await downloadQueue.download(url, 'playlist', { name: playlist.name || 'Unknown Playlist' });
    // Make the queue visible after queueing
    downloadQueue.toggleVisibility(true);
  } catch (error) {
    showError('Playlist download failed: ' + (error?.message || 'Unknown error'));
    throw error;
  }
}

/**
 * Initiates album downloads for each unique album in the playlist,
 * adding a 20ms delay between each album download and updating the button
 * with the progress (queued_albums/total_albums).
 */
async function downloadPlaylistAlbums(playlist) {
  if (!playlist?.tracks?.items) {
    showError('No tracks found in this playlist.');
    return;
  }
  
  // Build a map of unique albums (using album ID as the key).
  const albumMap = new Map();
  playlist.tracks.items.forEach(item => {
    if (!item?.track?.album) return;
    
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
      if (!album) continue;
      
      const albumUrl = album.external_urls?.spotify || '';
      if (!albumUrl) continue;
      
      // Use the centralized downloadQueue.download method
      await downloadQueue.download(
        albumUrl,
        'album',
        { name: album.name || 'Unknown Album' }
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
    
    // Make the queue visible after queueing all albums
    downloadQueue.toggleVisibility(true);
  } catch (error) {
    // Propagate any errors encountered.
    throw error;
  }
}

/**
 * Starts the download process using the centralized download method from the queue.
 */
async function startDownload(url, type, item, albumType) {
  if (!url || !type) {
    showError('Missing URL or type for download');
    return;
  }
  
  try {
    // Use the centralized downloadQueue.download method
    await downloadQueue.download(url, type, item, albumType);
    
    // Make the queue visible after queueing
    downloadQueue.toggleVisibility(true);
  } catch (error) {
    showError('Download failed: ' + (error?.message || 'Unknown error'));
    throw error;
  }
}

/**
 * A helper function to extract a display name from the URL.
 */
function extractName(url) {
  return url || 'Unknown';
}
