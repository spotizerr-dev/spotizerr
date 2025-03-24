// Import the downloadQueue singleton
import { downloadQueue } from './queue.js';

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
      return response.json();
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
});

function renderArtist(artistData, artistId) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');

  // Check if explicit filter is enabled
  const isExplicitFilterEnabled = downloadQueue.isExplicitFilterEnabled();

  const firstAlbum = artistData.items?.[0] || {};
  const artistName = firstAlbum?.artists?.[0]?.name || 'Unknown Artist';
  const artistImage = firstAlbum?.images?.[0]?.url || '/static/images/placeholder.jpg';

  document.getElementById('artist-name').innerHTML =
    `<a href="/artist/${artistId}" class="artist-link">${artistName}</a>`;
  document.getElementById('artist-stats').textContent = `${artistData.total || '0'} albums`;
  document.getElementById('artist-image').src = artistImage;

  // Define the artist URL (used by both full-discography and group downloads)
  const artistUrl = `https://open.spotify.com/artist/${artistId}`;

  // Home Button
  let homeButton = document.getElementById('homeButton');
  if (!homeButton) {
    homeButton = document.createElement('button');
    homeButton.id = 'homeButton';
    homeButton.className = 'home-btn';
    homeButton.innerHTML = `<img src="/static/images/home.svg" alt="Home">`;
    document.getElementById('artist-header').prepend(homeButton);
  }
  homeButton.addEventListener('click', () => window.location.href = window.location.origin);

  // Download Whole Artist Button using the new artist API endpoint
  let downloadArtistBtn = document.getElementById('downloadArtistBtn');
  if (!downloadArtistBtn) {
    downloadArtistBtn = document.createElement('button');
    downloadArtistBtn.id = 'downloadArtistBtn';
    downloadArtistBtn.className = 'download-btn download-btn--main';
    downloadArtistBtn.textContent = 'Download All Discography';
    document.getElementById('artist-header').appendChild(downloadArtistBtn);
  }

  // When explicit filter is enabled, disable all download buttons
  if (isExplicitFilterEnabled) {
    // Disable the artist download button and display a message explaining why
    downloadArtistBtn.disabled = true;
    downloadArtistBtn.classList.add('download-btn--disabled');
    downloadArtistBtn.innerHTML = `<span title="Direct artist downloads are restricted when explicit filter is enabled. Please visit individual album pages.">Downloads Restricted</span>`;
  } else {
    // Normal behavior when explicit filter is not enabled
    downloadArtistBtn.addEventListener('click', () => {
      // Optionally remove other download buttons from individual albums.
      document.querySelectorAll('.download-btn:not(#downloadArtistBtn)').forEach(btn => btn.remove());
      downloadArtistBtn.disabled = true;
      downloadArtistBtn.textContent = 'Queueing...';

      // Queue the entire discography (albums, singles, compilations, and appears_on)
      // Use our local startDownload function instead of downloadQueue.startArtistDownload
      startDownload(
        artistUrl,
        'artist',
        { name: artistName, artist: artistName },
        'album,single,compilation,appears_on'
      )
        .then((taskIds) => {
          downloadArtistBtn.textContent = 'Artist queued';
          // Make the queue visible after queueing
          downloadQueue.toggleVisibility(true);
          
          // Optionally show number of albums queued
          if (Array.isArray(taskIds)) {
            downloadArtistBtn.title = `${taskIds.length} albums queued for download`;
          }
        })
        .catch(err => {
          downloadArtistBtn.textContent = 'Download All Discography';
          downloadArtistBtn.disabled = false;
          showError('Failed to queue artist download: ' + (err?.message || 'Unknown error'));
        });
    });
  }

  // Group albums by type (album, single, compilation, etc.) and separate "appears_on" albums
  const albumGroups = {};
  const appearingAlbums = [];

  (artistData.items || []).forEach(album => {
    if (!album) return;
    
    // Skip explicit albums if filter is enabled
    if (isExplicitFilterEnabled && album.explicit) {
      return;
    }
    
    // Check if this is an "appears_on" album
    if (album.album_group === 'appears_on') {
      appearingAlbums.push(album);
    } else {
      // Group by album_type for the artist's own releases
      const type = (album.album_type || 'unknown').toLowerCase();
      if (!albumGroups[type]) albumGroups[type] = [];
      albumGroups[type].push(album);
    }
  });

  // Render album groups
  const groupsContainer = document.getElementById('album-groups');
  groupsContainer.innerHTML = '';

  // Render regular album groups first
  for (const [groupType, albums] of Object.entries(albumGroups)) {
    const groupSection = document.createElement('section');
    groupSection.className = 'album-group';

    // If explicit filter is enabled, don't show the group download button
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

    groupSection.innerHTML = `
      ${groupHeaderHTML}
      <div class="albums-list"></div>
    `;

    const albumsContainer = groupSection.querySelector('.albums-list');
    albums.forEach(album => {
      if (!album) return;
      
      const albumElement = document.createElement('div');
      albumElement.className = 'album-card';

      // Create album card with or without download button based on explicit filter setting
      if (isExplicitFilterEnabled) {
        albumElement.innerHTML = `
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
      } else {
        albumElement.innerHTML = `
          <a href="/album/${album.id || ''}" class="album-link">
            <img src="${album.images?.[1]?.url || album.images?.[0]?.url || '/static/images/placeholder.jpg'}" 
                 alt="Album cover" 
                 class="album-cover">
          </a>
          <div class="album-info">
            <div class="album-title">${album.name || 'Unknown Album'}</div>
            <div class="album-artist">${album.artists?.map(a => a?.name || 'Unknown Artist').join(', ') || 'Unknown Artist'}</div>
          </div>
          <button class="download-btn download-btn--circle" 
                  data-url="${album.external_urls?.spotify || ''}" 
                  data-type="${album.album_type || 'album'}"
                  data-name="${album.name || 'Unknown Album'}"
                  title="Download">
            <img src="/static/images/download.svg" alt="Download">
          </button>
        `;
      }
      
      albumsContainer.appendChild(albumElement);
    });

    groupsContainer.appendChild(groupSection);
  }

  // Render "Featuring" section if there are any appearing albums
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

    featuringSection.innerHTML = `
      ${featuringHeaderHTML}
      <div class="albums-list"></div>
    `;

    const albumsContainer = featuringSection.querySelector('.albums-list');
    appearingAlbums.forEach(album => {
      if (!album) return;
      
      const albumElement = document.createElement('div');
      albumElement.className = 'album-card';

      // Create album card with or without download button based on explicit filter setting
      if (isExplicitFilterEnabled) {
        albumElement.innerHTML = `
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
      } else {
        albumElement.innerHTML = `
          <a href="/album/${album.id || ''}" class="album-link">
            <img src="${album.images?.[1]?.url || album.images?.[0]?.url || '/static/images/placeholder.jpg'}" 
                 alt="Album cover" 
                 class="album-cover">
          </a>
          <div class="album-info">
            <div class="album-title">${album.name || 'Unknown Album'}</div>
            <div class="album-artist">${album.artists?.map(a => a?.name || 'Unknown Artist').join(', ') || 'Unknown Artist'}</div>
          </div>
          <button class="download-btn download-btn--circle" 
                  data-url="${album.external_urls?.spotify || ''}" 
                  data-type="${album.album_type || 'album'}"
                  data-name="${album.name || 'Unknown Album'}"
                  title="Download">
            <img src="/static/images/download.svg" alt="Download">
          </button>
        `;
      }
      
      albumsContainer.appendChild(albumElement);
    });

    // Add to the end so it appears at the bottom
    groupsContainer.appendChild(featuringSection);
  }

  document.getElementById('artist-header').classList.remove('hidden');
  document.getElementById('albums-container').classList.remove('hidden');

  // Only attach download listeners if explicit filter is not enabled
  if (!isExplicitFilterEnabled) {
    attachDownloadListeners();
    // Pass the artist URL and name so the group buttons can use the artist download function
    attachGroupDownloadListeners(artistUrl, artistName);
  }
}

// Event listeners for group downloads using the artist download function
function attachGroupDownloadListeners(artistUrl, artistName) {
  document.querySelectorAll('.group-download-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const groupType = e.target.dataset.groupType || 'album'; // e.g. "album", "single", "compilation", "appears_on"
      e.target.disabled = true;
      
      // Custom text for the 'appears_on' group
      const displayType = groupType === 'appears_on' ? 'Featuring Albums' : `${capitalize(groupType)}s`;
      e.target.textContent = `Queueing all ${displayType}...`;

      try {
        // Use our local startDownload function with the group type filter
        const taskIds = await startDownload(
          artistUrl,
          'artist',
          { name: artistName || 'Unknown Artist', artist: artistName || 'Unknown Artist' },
          groupType // Only queue releases of this specific type.
        );
        
        // Optionally show number of albums queued
        const totalQueued = Array.isArray(taskIds) ? taskIds.length : 0;
        e.target.textContent = `Queued all ${displayType}`;
        e.target.title = `${totalQueued} albums queued for download`;
        
        // Make the queue visible after queueing
        downloadQueue.toggleVisibility(true);
      } catch (error) {
        e.target.textContent = `Download All ${displayType}`;
        e.target.disabled = false;
        showError(`Failed to queue download for all ${groupType}: ${error?.message || 'Unknown error'}`);
      }
    });
  });
}

// Individual download handlers remain unchanged.
function attachDownloadListeners() {
  document.querySelectorAll('.download-btn:not(.group-download-btn)').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = e.currentTarget.dataset.url || '';
      const name = e.currentTarget.dataset.name || 'Unknown';
      const type = e.currentTarget.dataset.type || 'album';
      
      e.currentTarget.remove();
      // Use the centralized downloadQueue.download method
      downloadQueue.download(url, type, { name, type })
        .catch(err => showError('Download failed: ' + (err?.message || 'Unknown error')));
    });
  });
}

// Add startDownload function (similar to track.js and main.js)
/**
 * Starts the download process via centralized download queue
 */
async function startDownload(url, type, item, albumType) {
  if (!url || !type) {
    showError('Missing URL or type for download');
    return;
  }
  
  try {
    // Use the centralized downloadQueue.download method for all downloads including artist downloads
    const result = await downloadQueue.download(url, type, item, albumType);
    
    // Make the queue visible after queueing
    downloadQueue.toggleVisibility(true);
    
    // Return the result for tracking
    return result;
  } catch (error) {
    showError('Download failed: ' + (error?.message || 'Unknown error'));
    throw error;
  }
}

// UI Helpers
function showError(message) {
  const errorEl = document.getElementById('error');
  if (errorEl) {
    errorEl.textContent = message || 'An error occurred';
    errorEl.classList.remove('hidden');
  }
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}
