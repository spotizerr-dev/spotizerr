// Import the downloadQueue singleton
import { downloadQueue } from './queue.js';

// Define interfaces for API data
interface Image {
  url: string;
  height?: number;
  width?: number;
}

interface Artist {
  id: string;
  name: string;
  external_urls: {
    spotify: string;
  };
}

interface Album {
  id: string;
  name: string;
  artists: Artist[];
  images: Image[];
  album_type: string; // "album", "single", "compilation"
  album_group?: string; // "album", "single", "compilation", "appears_on"
  external_urls: {
    spotify: string;
  };
  explicit?: boolean; // Added to handle explicit filter
  total_tracks?: number;
  release_date?: string;
  is_locally_known?: boolean; // Added for local DB status
}

interface ArtistData {
  items: Album[];
  total: number;
  // Add other properties if available from the API
  // For watch status, the artist object itself might have `is_watched` if we extend API
  // For now, we fetch status separately.
}

// Interface for watch status response
interface WatchStatusResponse {
  is_watched: boolean;
  artist_data?: any; // The artist data from DB if watched
}

document.addEventListener('DOMContentLoaded', () => {
  const pathSegments = window.location.pathname.split('/');
  const artistId = pathSegments[pathSegments.indexOf('artist') + 1];

  if (!artistId) {
    showError('No artist ID provided.');
    return;
  }

  // Fetch artist info directly
  fetch(`/api/artist/info?id=${encodeURIComponent(artistId)}`)
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok');
      return response.json() as Promise<ArtistData>;
    })
    .then(data => renderArtist(data, artistId))
    .catch(error => {
      console.error('Error:', error);
      showError('Failed to load artist info.');
    });

  const queueIcon = document.getElementById('queueIcon');
  if (queueIcon) {
    queueIcon.addEventListener('click', () => downloadQueue.toggleVisibility());
  }
  
  // Initialize the watch button after main artist rendering
  // This is done inside renderArtist after button element is potentially created.
});

function renderArtist(artistData: ArtistData, artistId: string) {
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.classList.add('hidden');
  
  const errorEl = document.getElementById('error');
  if (errorEl) errorEl.classList.add('hidden');

  // Check if explicit filter is enabled
  const isExplicitFilterEnabled = downloadQueue.isExplicitFilterEnabled();

  const firstAlbum = artistData.items?.[0];
  const artistName = firstAlbum?.artists?.[0]?.name || 'Unknown Artist';
  const artistImageSrc = firstAlbum?.images?.[0]?.url || '/static/images/placeholder.jpg';

  const artistNameEl = document.getElementById('artist-name');
  if (artistNameEl) {
    artistNameEl.innerHTML =
      `<a href="/artist/${artistId}" class="artist-link">${artistName}</a>`;
  }
  const artistStatsEl = document.getElementById('artist-stats');
  if (artistStatsEl) {
    artistStatsEl.textContent = `${artistData.total || '0'} albums`;
  }
  const artistImageEl = document.getElementById('artist-image') as HTMLImageElement | null;
  if (artistImageEl) {
    artistImageEl.src = artistImageSrc;
  }

  // Initialize Watch Button after other elements are rendered
  const watchArtistBtn = document.getElementById('watchArtistBtn') as HTMLButtonElement | null;
  if (watchArtistBtn) {
      initializeWatchButton(artistId);
  } else {
      console.warn("Watch artist button not found in HTML.");
  }

  // Define the artist URL (used by both full-discography and group downloads)
  // const artistUrl = `https://open.spotify.com/artist/${artistId}`; // Not directly used here anymore

  // Home Button
  let homeButton = document.getElementById('homeButton') as HTMLButtonElement | null;
  if (!homeButton) {
    homeButton = document.createElement('button');
    homeButton.id = 'homeButton';
    homeButton.className = 'home-btn';
    homeButton.innerHTML = `<img src="/static/images/home.svg" alt="Home">`;
    const artistHeader = document.getElementById('artist-header');
    if (artistHeader) artistHeader.prepend(homeButton);
  }
  if (homeButton) {
    homeButton.addEventListener('click', () => window.location.href = window.location.origin);
  }

  // Download Whole Artist Button using the new artist API endpoint
  let downloadArtistBtn = document.getElementById('downloadArtistBtn') as HTMLButtonElement | null;
  if (!downloadArtistBtn) {
    downloadArtistBtn = document.createElement('button');
    downloadArtistBtn.id = 'downloadArtistBtn';
    downloadArtistBtn.className = 'download-btn download-btn--main';
    downloadArtistBtn.textContent = 'Download All Discography';
    const artistHeader = document.getElementById('artist-header');
    if (artistHeader) artistHeader.appendChild(downloadArtistBtn);
  }

  // When explicit filter is enabled, disable all download buttons
  if (isExplicitFilterEnabled) {
    if (downloadArtistBtn) {
      downloadArtistBtn.disabled = true;
      downloadArtistBtn.classList.add('download-btn--disabled');
      downloadArtistBtn.innerHTML = `<span title="Direct artist downloads are restricted when explicit filter is enabled. Please visit individual album pages.">Downloads Restricted</span>`;
    }
  } else {
    if (downloadArtistBtn) {
      downloadArtistBtn.addEventListener('click', () => {
        document.querySelectorAll('.download-btn:not(#downloadArtistBtn)').forEach(btn => btn.remove());
        if (downloadArtistBtn) {
          downloadArtistBtn.disabled = true;
          downloadArtistBtn.textContent = 'Queueing...';
        }
        startDownload(
          artistId,
          'artist',
          { name: artistName, artist: artistName },
          'album,single,compilation,appears_on'
        )
          .then((taskIds) => {
            if (downloadArtistBtn) {
              downloadArtistBtn.textContent = 'Artist queued';
              downloadQueue.toggleVisibility(true);
              if (Array.isArray(taskIds)) {
                downloadArtistBtn.title = `${taskIds.length} albums queued for download`;
              }
            }
          })
          .catch(err => {
            if (downloadArtistBtn) {
              downloadArtistBtn.textContent = 'Download All Discography';
              downloadArtistBtn.disabled = false;
            }
            showError('Failed to queue artist download: ' + (err?.message || 'Unknown error'));
          });
      });
    }
  }

  const albumGroups: Record<string, Album[]> = {};
  const appearingAlbums: Album[] = [];

  (artistData.items || []).forEach(album => {
    if (!album) return;
    if (isExplicitFilterEnabled && album.explicit) {
      return;
    }
    if (album.album_group === 'appears_on') {
      appearingAlbums.push(album);
    } else {
      const type = (album.album_type || 'unknown').toLowerCase();
      if (!albumGroups[type]) albumGroups[type] = [];
      albumGroups[type].push(album);
    }
  });

  const groupsContainer = document.getElementById('album-groups');
  if (groupsContainer) {
    groupsContainer.innerHTML = '';

    // Determine if the artist is being watched to show/hide management buttons for albums
    const isArtistWatched = watchArtistBtn && watchArtistBtn.dataset.watching === 'true';

    for (const [groupType, albums] of Object.entries(albumGroups)) {
      const groupSection = document.createElement('section');
      groupSection.className = 'album-group';

      const groupHeaderHTML = isExplicitFilterEnabled ?
        `<div class="album-group-header">
          <h3>${capitalize(groupType)}s</h3>
          <div class="download-note">Visit album pages to download content</div>
        </div>` :
        `<div class="album-group-header">
          <h3>${capitalize(groupType)}s</h3>
          <button class="download-btn download-btn--main group-download-btn"
                  data-group-type="${groupType}">
            Download All ${capitalize(groupType)}s
          </button>
        </div>`;

      groupSection.innerHTML = groupHeaderHTML;
      const albumsListContainer = document.createElement('div');
      albumsListContainer.className = 'albums-list';

      albums.forEach(album => {
        if (!album) return;
        const albumElement = document.createElement('div');
        albumElement.className = 'album-card';
        
        let albumCardHTML = `
          <a href="/album/${album.id || ''}" class="album-link">
            <img src="${album.images?.[1]?.url || album.images?.[0]?.url || '/static/images/placeholder.jpg'}"
                 alt="Album cover"
                 class="album-cover">
          </a>
          <div class="album-info">
            <div class="album-title">${album.name || 'Unknown Album'}</div>
            <div class="album-artist">${album.artists?.map(a => a?.name || 'Unknown Artist').join(', ') || 'Unknown Artist'}</div>
          </div>
        `;

        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'album-actions-container';

        if (!isExplicitFilterEnabled) {
          const downloadBtnHTML = `
            <button class="download-btn download-btn--circle album-download-btn"
                    data-id="${album.id || ''}"
                    data-type="${album.album_type || 'album'}"
                    data-name="${album.name || 'Unknown Album'}"
                    title="Download">
              <img src="/static/images/download.svg" alt="Download">
            </button>
          `;
          actionsContainer.innerHTML += downloadBtnHTML;
        }

        if (isArtistWatched) {
          // Initial state is set based on album.is_locally_known
          const isKnown = album.is_locally_known === true;
          const initialStatus = isKnown ? "known" : "missing";
          const initialIcon = isKnown ? "/static/images/check.svg" : "/static/images/missing.svg";
          const initialTitle = isKnown ? "Click to mark as missing from DB" : "Click to mark as known in DB";
          
          const toggleKnownBtnHTML = `
            <button class="action-btn toggle-known-status-btn" 
                    data-id="${album.id || ''}"
                    data-artist-id="${artistId}" 
                    data-status="${initialStatus}" 
                    title="${initialTitle}">
              <img src="${initialIcon}" alt="Mark as Missing/Known">
            </button>
          `;
          actionsContainer.innerHTML += toggleKnownBtnHTML;
        }

        albumElement.innerHTML = albumCardHTML;
        if (actionsContainer.hasChildNodes()) {
            albumElement.appendChild(actionsContainer);
        }
        albumsListContainer.appendChild(albumElement);
      });
      groupSection.appendChild(albumsListContainer);
      groupsContainer.appendChild(groupSection);
    }

    if (appearingAlbums.length > 0) {
      const featuringSection = document.createElement('section');
      featuringSection.className = 'album-group';
      const featuringHeaderHTML = isExplicitFilterEnabled ?
        `<div class="album-group-header">
          <h3>Featuring</h3>
          <div class="download-note">Visit album pages to download content</div>
        </div>` :
        `<div class="album-group-header">
          <h3>Featuring</h3>
          <button class="download-btn download-btn--main group-download-btn"
                  data-group-type="appears_on">
            Download All Featuring Albums
          </button>
        </div>`;
      featuringSection.innerHTML = featuringHeaderHTML;
      const appearingAlbumsListContainer = document.createElement('div');
      appearingAlbumsListContainer.className = 'albums-list';

      appearingAlbums.forEach(album => {
        if (!album) return;
        const albumElement = document.createElement('div');
        albumElement.className = 'album-card';
        let albumCardHTML = `
          <a href="/album/${album.id || ''}" class="album-link">
            <img src="${album.images?.[1]?.url || album.images?.[0]?.url || '/static/images/placeholder.jpg'}"
                 alt="Album cover"
                 class="album-cover">
          </a>
          <div class="album-info">
            <div class="album-title">${album.name || 'Unknown Album'}</div>
            <div class="album-artist">${album.artists?.map(a => a?.name || 'Unknown Artist').join(', ') || 'Unknown Artist'}</div>
          </div>
        `;
        
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'album-actions-container';

        if (!isExplicitFilterEnabled) {
          const downloadBtnHTML = `
            <button class="download-btn download-btn--circle album-download-btn"
                    data-id="${album.id || ''}"
                    data-type="${album.album_type || 'album'}"
                    data-name="${album.name || 'Unknown Album'}"
                    title="Download">
              <img src="/static/images/download.svg" alt="Download">
            </button>
          `;
          actionsContainer.innerHTML += downloadBtnHTML;
        }

        if (isArtistWatched) {
          // Initial state is set based on album.is_locally_known
          const isKnown = album.is_locally_known === true;
          const initialStatus = isKnown ? "known" : "missing";
          const initialIcon = isKnown ? "/static/images/check.svg" : "/static/images/missing.svg";
          const initialTitle = isKnown ? "Click to mark as missing from DB" : "Click to mark as known in DB";
          
          const toggleKnownBtnHTML = `
            <button class="action-btn toggle-known-status-btn" 
                    data-id="${album.id || ''}"
                    data-artist-id="${artistId}" 
                    data-status="${initialStatus}" 
                    title="${initialTitle}">
              <img src="${initialIcon}" alt="Mark as Missing/Known">
            </button>
          `;
          actionsContainer.innerHTML += toggleKnownBtnHTML;
        }
        albumElement.innerHTML = albumCardHTML;
        if (actionsContainer.hasChildNodes()) {
            albumElement.appendChild(actionsContainer);
        }
        appearingAlbumsListContainer.appendChild(albumElement);
      });
      featuringSection.appendChild(appearingAlbumsListContainer);
      groupsContainer.appendChild(featuringSection);
    }
  }

  const artistHeaderEl = document.getElementById('artist-header');
  if (artistHeaderEl) artistHeaderEl.classList.remove('hidden');
  const albumsContainerEl = document.getElementById('albums-container');
  if (albumsContainerEl) albumsContainerEl.classList.remove('hidden');

  if (!isExplicitFilterEnabled) {
    attachAlbumActionListeners(artistId);
    attachGroupDownloadListeners(artistId, artistName);
  }
}

function attachGroupDownloadListeners(artistId: string, artistName: string) {
  document.querySelectorAll('.group-download-btn').forEach(btn => {
    const button = btn as HTMLButtonElement;
    button.addEventListener('click', async (e) => {
      const target = e.target as HTMLButtonElement | null;
      if (!target) return;
      const groupType = target.dataset.groupType || 'album';
      target.disabled = true;
      const displayType = groupType === 'appears_on' ? 'Featuring Albums' : `${capitalize(groupType)}s`;
      target.textContent = `Queueing all ${displayType}...`;
      try {
        const taskIds = await startDownload(
          artistId,
          'artist',
          { name: artistName || 'Unknown Artist', artist: artistName || 'Unknown Artist' },
          groupType
        );
        const totalQueued = Array.isArray(taskIds) ? taskIds.length : 0;
        target.textContent = `Queued all ${displayType}`;
        target.title = `${totalQueued} albums queued for download`;
        downloadQueue.toggleVisibility(true);
      } catch (error: any) {
        target.textContent = `Download All ${displayType}`;
        target.disabled = false;
        showError(`Failed to queue download for all ${groupType}: ${error?.message || 'Unknown error'}`);
      }
    });
  });
}

function attachAlbumActionListeners(artistIdForContext: string) {
  document.querySelectorAll('.album-download-btn').forEach(btn => {
    const button = btn as HTMLButtonElement;
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentTarget = e.currentTarget as HTMLButtonElement | null;
      if (!currentTarget) return;
      const itemId = currentTarget.dataset.id || '';
      const name = currentTarget.dataset.name || 'Unknown';
      const type = 'album';
      if (!itemId) {
        showError('Could not get album ID for download');
        return;
      }
      currentTarget.remove();
      downloadQueue.download(itemId, type, { name, type })
        .catch((err: any) => showError('Download failed: ' + (err?.message || 'Unknown error')));
    });
  });

  document.querySelectorAll('.toggle-known-status-btn').forEach((btn) => {
    btn.addEventListener('click', async (e: Event) => {
      e.stopPropagation();
      const button = e.currentTarget as HTMLButtonElement;
      const albumId = button.dataset.id || '';
      const artistId = button.dataset.artistId || artistIdForContext; 
      const currentStatus = button.dataset.status;
      const img = button.querySelector('img');

      if (!albumId || !artistId || !img) {
        showError('Missing data for toggling album status');
        return;
      }

      button.disabled = true;
      try {
        if (currentStatus === 'missing') {
          await handleMarkAlbumAsKnown(artistId, albumId);
          button.dataset.status = 'known';
          img.src = '/static/images/check.svg';
          button.title = 'Click to mark as missing from DB';
        } else {
          await handleMarkAlbumAsMissing(artistId, albumId);
          button.dataset.status = 'missing';
          img.src = '/static/images/missing.svg';
          button.title = 'Click to mark as known in DB';
        }
      } catch (error) {
        showError('Failed to update album status. Please try again.');
      }
      button.disabled = false;
    });
  });
}

async function handleMarkAlbumAsKnown(artistId: string, albumId: string) {
  try {
    const response = await fetch(`/api/artist/watch/${artistId}/albums`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([albumId]),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    const result = await response.json();
    showNotification(result.message || 'Album marked as known.');
  } catch (error: any) {
    showError(`Failed to mark album as known: ${error.message}`);
    throw error; // Re-throw for the caller to handle button state if needed
  }
}

async function handleMarkAlbumAsMissing(artistId: string, albumId: string) {
  try {
    const response = await fetch(`/api/artist/watch/${artistId}/albums`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([albumId]),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    const result = await response.json();
    showNotification(result.message || 'Album marked as missing.');
  } catch (error: any) {
    showError(`Failed to mark album as missing: ${error.message}`);
    throw error; // Re-throw
  }
}

// Add startDownload function (similar to track.js and main.js)
/**
 * Starts the download process via centralized download queue
 */
async function startDownload(itemId: string, type: string, item: { name: string, artist?: string, type?: string }, albumType?: string) {
  if (!itemId || !type) {
    showError('Missing ID or type for download');
    return Promise.reject(new Error('Missing ID or type for download')); // Return a rejected promise
  }
  
  try {
    // Use the centralized downloadQueue.download method for all downloads including artist downloads
    const result = await downloadQueue.download(itemId, type, item, albumType);
    
    // Make the queue visible after queueing
    downloadQueue.toggleVisibility(true);
    
    // Return the result for tracking
    return result;
  } catch (error: any) { // Add type for error
    showError('Download failed: ' + (error?.message || 'Unknown error'));
    throw error;
  }
}

// UI Helpers
function showError(message: string) {
  const errorEl = document.getElementById('error');
  if (errorEl) {
    errorEl.textContent = message || 'An error occurred';
    errorEl.classList.remove('hidden');
  }
}

function capitalize(str: string) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

async function getArtistWatchStatus(artistId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/artist/watch/${artistId}/status`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})); // Catch if res not json
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    const data: WatchStatusResponse = await response.json();
    return data.is_watched;
  } catch (error) {
    console.error('Error fetching artist watch status:', error);
    showError('Could not fetch watch status.');
    return false; // Assume not watching on error
  }
}

async function watchArtist(artistId: string): Promise<void> {
  try {
    const response = await fetch(`/api/artist/watch/${artistId}`, {
      method: 'PUT',
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    // Optionally handle success message from response.json()
    await response.json(); 
  } catch (error) {
    console.error('Error watching artist:', error);
    showError('Failed to watch artist.');
    throw error; // Re-throw to allow caller to handle UI update failure
  }
}

async function unwatchArtist(artistId: string): Promise<void> {
  try {
    const response = await fetch(`/api/artist/watch/${artistId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    // Optionally handle success message
    await response.json();
  } catch (error) {
    console.error('Error unwatching artist:', error);
    showError('Failed to unwatch artist.');
    throw error; // Re-throw
  }
}

function updateWatchButton(artistId: string, isWatching: boolean) {
  const watchArtistBtn = document.getElementById('watchArtistBtn') as HTMLButtonElement | null;
  const syncArtistBtn = document.getElementById('syncArtistBtn') as HTMLButtonElement | null;

  if (watchArtistBtn) {
    const img = watchArtistBtn.querySelector('img');
    if (isWatching) {
      if (img) img.src = '/static/images/eye-crossed.svg';
      watchArtistBtn.innerHTML = `<img src="/static/images/eye-crossed.svg" alt="Unwatch"> Unwatch Artist`;
      watchArtistBtn.classList.add('watching');
      watchArtistBtn.title = "Stop watching this artist";
      if (syncArtistBtn) syncArtistBtn.classList.remove('hidden');
    } else {
      if (img) img.src = '/static/images/eye.svg';
      watchArtistBtn.innerHTML = `<img src="/static/images/eye.svg" alt="Watch"> Watch Artist`;
      watchArtistBtn.classList.remove('watching');
      watchArtistBtn.title = "Watch this artist for new releases";
      if (syncArtistBtn) syncArtistBtn.classList.add('hidden');
    }
    watchArtistBtn.dataset.watching = isWatching ? 'true' : 'false';
  }
}

async function initializeWatchButton(artistId: string) {
  const watchArtistBtn = document.getElementById('watchArtistBtn') as HTMLButtonElement | null;
  const syncArtistBtn = document.getElementById('syncArtistBtn') as HTMLButtonElement | null;

  if (!watchArtistBtn) return;

  try {
    watchArtistBtn.disabled = true; // Disable while fetching status
    if (syncArtistBtn) syncArtistBtn.disabled = true; // Also disable sync button initially

    const isWatching = await getArtistWatchStatus(artistId);
    updateWatchButton(artistId, isWatching);
    watchArtistBtn.disabled = false;
    if (syncArtistBtn) syncArtistBtn.disabled = !(watchArtistBtn.dataset.watching === 'true'); // Corrected logic

    watchArtistBtn.addEventListener('click', async () => {
      const currentlyWatching = watchArtistBtn.dataset.watching === 'true';
      watchArtistBtn.disabled = true;
      if (syncArtistBtn) syncArtistBtn.disabled = true;
      try {
        if (currentlyWatching) {
          await unwatchArtist(artistId);
          updateWatchButton(artistId, false);
        } else {
          await watchArtist(artistId);
          updateWatchButton(artistId, true);
        }
      } catch (error) {
        updateWatchButton(artistId, currentlyWatching);
      }
      watchArtistBtn.disabled = false;
      if (syncArtistBtn) syncArtistBtn.disabled = !(watchArtistBtn.dataset.watching === 'true'); // Corrected logic
    });

    // Add event listener for the sync button
    if (syncArtistBtn) {
      syncArtistBtn.addEventListener('click', async () => {
        syncArtistBtn.disabled = true;
        const originalButtonContent = syncArtistBtn.innerHTML; // Store full HTML
        const textNode = Array.from(syncArtistBtn.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
        const originalText = textNode ? textNode.nodeValue : 'Sync Watched Artist'; // Fallback text
        
        syncArtistBtn.innerHTML = `<img src="/static/images/refresh.svg" alt="Sync"> Syncing...`; // Keep icon
        try {
          await triggerArtistSync(artistId);
          showNotification('Artist sync triggered successfully.'); 
        } catch (error) {
          // Error is shown by triggerArtistSync
        }
        syncArtistBtn.innerHTML = originalButtonContent; // Restore full original HTML
        syncArtistBtn.disabled = false;
      });
    }

  } catch (error) {
    if (watchArtistBtn) watchArtistBtn.disabled = false;
    if (syncArtistBtn) syncArtistBtn.disabled = true; // Keep sync disabled on error
    updateWatchButton(artistId, false); 
  }
}

// New function to trigger artist sync
async function triggerArtistSync(artistId: string): Promise<void> {
  try {
    const response = await fetch(`/api/artist/watch/trigger_check/${artistId}`, {
      method: 'POST',
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    await response.json(); // Contains success message
  } catch (error) {
    console.error('Error triggering artist sync:', error);
    showError('Failed to trigger artist sync.');
    throw error; // Re-throw
  }
}

/**
 * Displays a temporary notification message.
 */
function showNotification(message: string) {
  // Basic notification - consider a more robust solution for production
  const notificationEl = document.createElement('div');
  notificationEl.className = 'notification'; // Ensure this class is styled
  notificationEl.textContent = message;
  document.body.appendChild(notificationEl);
  setTimeout(() => {
    notificationEl.remove();
  }, 3000);
}
