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
function renderPlaylist(playlist: any) {
  // Hide loading and error messages
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.classList.add('hidden');
  const errorEl = document.getElementById('error');
  if (errorEl) errorEl.classList.add('hidden');

  // Check if explicit filter is enabled
  const isExplicitFilterEnabled = downloadQueue.isExplicitFilterEnabled();

  // Update header info
  const playlistNameEl = document.getElementById('playlist-name');
  if (playlistNameEl) playlistNameEl.textContent = playlist.name || 'Unknown Playlist';
  const playlistOwnerEl = document.getElementById('playlist-owner');
  if (playlistOwnerEl) playlistOwnerEl.textContent = `By ${playlist.owner?.display_name || 'Unknown User'}`;
  const playlistStatsEl = document.getElementById('playlist-stats');
  if (playlistStatsEl) playlistStatsEl.textContent =
    `${playlist.followers?.total || '0'} followers • ${playlist.tracks?.total || '0'} songs`;
  const playlistDescriptionEl = document.getElementById('playlist-description');
  if (playlistDescriptionEl) playlistDescriptionEl.textContent = playlist.description || '';
  const image = playlist.images?.[0]?.url || '/static/images/placeholder.jpg';
  const playlistImageEl = document.getElementById('playlist-image') as HTMLImageElement;
  if (playlistImageEl) playlistImageEl.src = image;

  // --- Add Home Button ---
  let homeButton = document.getElementById('homeButton') as HTMLButtonElement;
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

  // Check if any track in the playlist is explicit when filter is enabled
  let hasExplicitTrack = false;
  if (isExplicitFilterEnabled && playlist.tracks?.items) {
    hasExplicitTrack = playlist.tracks.items.some(item => item?.track && item.track.explicit);
  }

  // --- Add "Download Whole Playlist" Button ---
  let downloadPlaylistBtn = document.getElementById('downloadPlaylistBtn') as HTMLButtonElement;
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

  // --- Add "Download Playlist's Albums" Button ---
  let downloadAlbumsBtn = document.getElementById('downloadAlbumsBtn') as HTMLButtonElement;
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

  if (isExplicitFilterEnabled && hasExplicitTrack) {
    // Disable both playlist buttons and display messages explaining why
    if (downloadPlaylistBtn) {
      downloadPlaylistBtn.disabled = true;
      downloadPlaylistBtn.classList.add('download-btn--disabled');
      downloadPlaylistBtn.innerHTML = `<span title="Cannot download entire playlist because it contains explicit tracks">Playlist Contains Explicit Tracks</span>`;
    }
    
    if (downloadAlbumsBtn) {
      downloadAlbumsBtn.disabled = true;
      downloadAlbumsBtn.classList.add('download-btn--disabled');
      downloadAlbumsBtn.innerHTML = `<span title="Cannot download albums from this playlist because it contains explicit tracks">Albums Access Restricted</span>`;
    }
  } else {
    // Normal behavior when no explicit tracks are present
    if (downloadPlaylistBtn) {
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
        }).catch((err: any) => {
          showError('Failed to queue playlist download: ' + (err?.message || 'Unknown error'));
          downloadPlaylistBtn.disabled = false;
        });
      });
    }

    if (downloadAlbumsBtn) {
      downloadAlbumsBtn.addEventListener('click', () => {
        // Remove individual track download buttons (but leave this album button).
        document.querySelectorAll('.download-btn').forEach(btn => {
          if (btn.id !== 'downloadAlbumsBtn') btn.remove();
        });

        downloadAlbumsBtn.disabled = true;
        downloadAlbumsBtn.textContent = 'Queueing...';

        downloadPlaylistAlbums(playlist)
          .then(() => {
            if (downloadAlbumsBtn) downloadAlbumsBtn.textContent = 'Queued!';
          })
          .catch((err: any) => {
            showError('Failed to queue album downloads: ' + (err?.message || 'Unknown error'));
            if (downloadAlbumsBtn) downloadAlbumsBtn.disabled = false;
          });
      });
    }
  }

  // Render tracks list
  const tracksList = document.getElementById('tracks-list');
  if (!tracksList) return;
  
  tracksList.innerHTML = ''; // Clear any existing content

  if (playlist.tracks?.items) {
    playlist.tracks.items.forEach((item, index) => {
      if (!item || !item.track) return; // Skip null/undefined tracks
      
      const track = item.track;
      
      // Skip explicit tracks if filter is enabled
      if (isExplicitFilterEnabled && track.explicit) {
        // Add a placeholder for filtered explicit tracks
        const trackElement = document.createElement('div');
        trackElement.className = 'track track-filtered';
        trackElement.innerHTML = `
          <div class="track-number">${index + 1}</div>
          <div class="track-info">
            <div class="track-name explicit-filtered">Explicit Content Filtered</div>
            <div class="track-artist">This track is not shown due to explicit content filter settings</div>
          </div>
          <div class="track-album">Not available</div>
          <div class="track-duration">--:--</div>
        `;
        tracksList.appendChild(trackElement);
        return;
      }
      
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
  const playlistHeaderEl = document.getElementById('playlist-header');
  if (playlistHeaderEl) playlistHeaderEl.classList.remove('hidden');
  const tracksContainerEl = document.getElementById('tracks-container');
  if (tracksContainerEl) tracksContainerEl.classList.remove('hidden');

  // Attach download listeners to newly rendered download buttons
  attachDownloadListeners();
}

/**
 * Converts milliseconds to minutes:seconds.
 */
function msToTime(duration: number) {
  if (!duration || isNaN(duration)) return '0:00';
  
  const minutes = Math.floor(duration / 60000);
  const seconds = ((duration % 60000) / 1000).toFixed(0);
  return `${minutes}:${seconds.padStart(2, '0')}`;
}

/**
 * Displays an error message in the UI.
 */
function showError(message: string) {
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
    btn.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      const currentTarget = e.currentTarget as HTMLButtonElement;
      const url = currentTarget.dataset.url || '';
      const type = currentTarget.dataset.type || '';
      const name = currentTarget.dataset.name || extractName(url) || 'Unknown';
      // Remove the button immediately after click.
      currentTarget.remove();
      startDownload(url, type, { name }, ''); // Added empty string for albumType
    });
  });
}

/**
 * Initiates the whole playlist download by calling the playlist endpoint.
 */
async function downloadWholePlaylist(playlist: any) {
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
  } catch (error: any) {
    showError('Playlist download failed: ' + (error?.message || 'Unknown error'));
    throw error;
  }
}

/**
 * Initiates album downloads for each unique album in the playlist,
 * adding a 20ms delay between each album download and updating the button
 * with the progress (queued_albums/total_albums).
 */
async function downloadPlaylistAlbums(playlist: any) {
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
  const downloadAlbumsBtn = document.getElementById('downloadAlbumsBtn') as HTMLButtonElement | null;
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
  } catch (error: any) {
    // Propagate any errors encountered.
    throw error;
  }
}

/**
 * Starts the download process using the centralized download method from the queue.
 */
async function startDownload(url: string, type: string, item: any, albumType?: string) {
  if (!url || !type) {
    showError('Missing URL or type for download');
    return;
  }
  
  try {
    // Use the centralized downloadQueue.download method
    await downloadQueue.download(url, type, item, albumType);
    
    // Make the queue visible after queueing
    downloadQueue.toggleVisibility(true);
  } catch (error: any) {
    showError('Download failed: ' + (error?.message || 'Unknown error'));
    throw error;
  }
}

/**
 * A helper function to extract a display name from the URL.
 */
function extractName(url: string | null): string {
  return url || 'Unknown';
}
