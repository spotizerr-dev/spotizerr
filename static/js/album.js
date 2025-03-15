import { downloadQueue } from './queue.js';

document.addEventListener('DOMContentLoaded', () => {
  const pathSegments = window.location.pathname.split('/');
  const albumId = pathSegments[pathSegments.indexOf('album') + 1];

  if (!albumId) {
    showError('No album ID provided.');
    return;
  }

  // Fetch the config to get active Spotify account first
  fetch('/api/config')
    .then(response => {
      if (!response.ok) throw new Error('Failed to fetch config');
      return response.json();
    })
    .then(config => {
      const mainAccount = config.spotify || '';
      
      // Then fetch album info with the main parameter
      return fetch(`/api/album/info?id=${encodeURIComponent(albumId)}&main=${mainAccount}`);
    })
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok');
      return response.json();
    })
    .then(data => renderAlbum(data))
    .catch(error => {
      console.error('Error:', error);
      showError('Failed to load album.');
    });

  const queueIcon = document.getElementById('queueIcon');
  if (queueIcon) {
    queueIcon.addEventListener('click', () => {
      downloadQueue.toggleVisibility();
    });
  }
});

function renderAlbum(album) {
  // Hide loading and error messages.
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');

  const baseUrl = window.location.origin;

  // Set album header info.
  document.getElementById('album-name').innerHTML = 
    `<a href="${baseUrl}/album/${album.id}">${album.name}</a>`;

  document.getElementById('album-artist').innerHTML = 
    `By ${album.artists.map(artist => `<a href="${baseUrl}/artist/${artist.id}">${artist.name}</a>`).join(', ')}`;

  const releaseYear = new Date(album.release_date).getFullYear();
  document.getElementById('album-stats').textContent =
    `${releaseYear} • ${album.total_tracks} songs • ${album.label}`;

  document.getElementById('album-copyright').textContent =
    album.copyrights.map(c => c.text).join(' • ');

  const image = album.images[0]?.url || 'placeholder.jpg';
  document.getElementById('album-image').src = image;

  // Create (if needed) the Home Button.
  let homeButton = document.getElementById('homeButton');
  if (!homeButton) {
    homeButton = document.createElement('button');
    homeButton.id = 'homeButton';
    homeButton.className = 'home-btn';

    const homeIcon = document.createElement('img');
    homeIcon.src = '/static/images/home.svg';
    homeIcon.alt = 'Home';
    homeButton.appendChild(homeIcon);

    // Insert as first child of album-header.
    const headerContainer = document.getElementById('album-header');
    headerContainer.insertBefore(homeButton, headerContainer.firstChild);
  }
  homeButton.addEventListener('click', () => {
    window.location.href = window.location.origin;
  });

  // Create (if needed) the Download Album Button.
  let downloadAlbumBtn = document.getElementById('downloadAlbumBtn');
  if (!downloadAlbumBtn) {
    downloadAlbumBtn = document.createElement('button');
    downloadAlbumBtn.id = 'downloadAlbumBtn';
    downloadAlbumBtn.textContent = 'Download Full Album';
    downloadAlbumBtn.className = 'download-btn download-btn--main';
    document.getElementById('album-header').appendChild(downloadAlbumBtn);
  }
  
  downloadAlbumBtn.addEventListener('click', () => {
    // Remove any other download buttons (keeping the full-album button in place).
    document.querySelectorAll('.download-btn').forEach(btn => {
      if (btn.id !== 'downloadAlbumBtn') btn.remove();
    });

    downloadAlbumBtn.disabled = true;
    downloadAlbumBtn.textContent = 'Queueing...';

    downloadWholeAlbum(album)
      .then(() => {
        downloadAlbumBtn.textContent = 'Queued!';
      })
      .catch(err => {
        showError('Failed to queue album download: ' + err.message);
        downloadAlbumBtn.disabled = false;
      });
  });

  // Render each track.
  const tracksList = document.getElementById('tracks-list');
  tracksList.innerHTML = '';

  album.tracks.items.forEach((track, index) => {
    const trackElement = document.createElement('div');
    trackElement.className = 'track';
    trackElement.innerHTML = `
      <div class="track-number">${index + 1}</div>
      <div class="track-info">
        <div class="track-name">
          <a href="${baseUrl}/track/${track.id}">${track.name}</a>
        </div>
        <div class="track-artist">
          ${track.artists.map(a => `<a href="${baseUrl}/artist/${a.id}">${a.name}</a>`).join(', ')}
        </div>
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

  // Reveal header and track list.
  document.getElementById('album-header').classList.remove('hidden');
  document.getElementById('tracks-container').classList.remove('hidden');
  attachDownloadListeners();

  // If on a small screen, re-arrange the action buttons.
  if (window.innerWidth <= 480) {
    let actionsContainer = document.getElementById('album-actions');
    if (!actionsContainer) {
      actionsContainer = document.createElement('div');
      actionsContainer.id = 'album-actions';
      document.getElementById('album-header').appendChild(actionsContainer);
    }
    // Append in the desired order: Home, Download, then Queue Toggle (if exists).
    actionsContainer.innerHTML = ''; // Clear any previous content
    actionsContainer.appendChild(document.getElementById('homeButton'));
    actionsContainer.appendChild(document.getElementById('downloadAlbumBtn'));
    const queueToggle = document.querySelector('.queue-toggle');
    if (queueToggle) {
      actionsContainer.appendChild(queueToggle);
    }
  }
}

async function downloadWholeAlbum(album) {
  const url = album.external_urls.spotify;
  try {
    await downloadQueue.startAlbumDownload(url, { name: album.name });
  } catch (error) {
    showError('Album download failed: ' + error.message);
    throw error;
  }
}

function msToTime(duration) {
  const minutes = Math.floor(duration / 60000);
  const seconds = ((duration % 60000) / 1000).toFixed(0);
  return `${minutes}:${seconds.padStart(2, '0')}`;
}

function showError(message) {
  const errorEl = document.getElementById('error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

function attachDownloadListeners() {
  document.querySelectorAll('.download-btn').forEach((btn) => {
    if (btn.id === 'downloadAlbumBtn') return;
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

async function startDownload(url, type, item, albumType) {
  const config = JSON.parse(localStorage.getItem('activeConfig')) || {};
  const {
    fallback = false,
    spotify = '',
    deezer = '',
    spotifyQuality = 'NORMAL',
    deezerQuality = 'MP3_128',
    realTime = false,
    customDirFormat = '',
    customTrackFormat = ''
  } = config;

  const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
  let apiUrl = '';

  if (type === 'album') {
    apiUrl = `/api/album/download?service=${service}&url=${encodeURIComponent(url)}`;
  } else if (type === 'artist') {
    apiUrl = `/api/artist/download?service=${service}&artist_url=${encodeURIComponent(url)}&album_type=${encodeURIComponent(albumType || 'album,single,compilation')}`;
  } else {
    apiUrl = `/api/${type}/download?service=${service}&url=${encodeURIComponent(url)}`;
  }

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

  // Append custom directory and file format settings if provided.
  if (customDirFormat) {
    apiUrl += `&custom_dir_format=${encodeURIComponent(customDirFormat)}`;
  }
  if (customTrackFormat) {
    apiUrl += `&custom_file_format=${encodeURIComponent(customTrackFormat)}`;
  }

  try {
    const response = await fetch(apiUrl);
    const data = await response.json();
    downloadQueue.addDownload(item, type, data.prg_file);
  } catch (error) {
    showError('Download failed: ' + error.message);
  }
}

function extractName(url) {
  return url;
}
