import { downloadQueue } from './queue.js';

document.addEventListener('DOMContentLoaded', () => {
  const pathSegments = window.location.pathname.split('/');
  const albumId = pathSegments[pathSegments.indexOf('album') + 1];

  if (!albumId) {
    showError('No album ID provided.');
    return;
  }

  fetch(`/api/album/info?id=${encodeURIComponent(albumId)}`)
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
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');

  const baseUrl = window.location.origin;

  // Album header info with embedded links

  // Album name becomes a link to the album page.
  document.getElementById('album-name').innerHTML = 
    `<a href="${baseUrl}/album/${album.id}">${album.name}</a>`;

  // Album artists become links to their artist pages.
  document.getElementById('album-artist').innerHTML = 
    `By ${album.artists.map(artist => `<a href="${baseUrl}/artist/${artist.id}">${artist.name}</a>`).join(', ')}`;

  const releaseYear = new Date(album.release_date).getFullYear();
  document.getElementById('album-stats').textContent =
    `${releaseYear} • ${album.total_tracks} songs • ${album.label}`;

  document.getElementById('album-copyright').textContent =
    album.copyrights.map(c => c.text).join(' • ');

  const image = album.images[0]?.url || 'placeholder.jpg';
  document.getElementById('album-image').src = image;

  // Back Button
  let backButton = document.getElementById('backButton');
  if (!backButton) {
    backButton = document.createElement('button');
    backButton.id = 'backButton';
    backButton.textContent = 'Back';
    backButton.className = 'back-btn';
    const headerContainer = document.getElementById('album-header');
    headerContainer.insertBefore(backButton, headerContainer.firstChild);
  }
  backButton.addEventListener('click', () => {
    window.location.href = window.location.origin;
  });

  // Download Album Button
  let downloadAlbumBtn = document.getElementById('downloadAlbumBtn');
  if (!downloadAlbumBtn) {
    downloadAlbumBtn = document.createElement('button');
    downloadAlbumBtn.id = 'downloadAlbumBtn';
    downloadAlbumBtn.textContent = 'Download Full Album';
    downloadAlbumBtn.className = 'download-btn download-btn--main';
    document.getElementById('album-header').appendChild(downloadAlbumBtn);
  }
  
  downloadAlbumBtn.addEventListener('click', () => {
    document.querySelectorAll('.download-btn').forEach(btn => {
      if (btn.id !== 'downloadAlbumBtn') btn.remove();
    });

    downloadAlbumBtn.disabled = true;
    downloadAlbumBtn.textContent = 'Queueing...';

    downloadWholeAlbum(album).then(() => {
      downloadAlbumBtn.textContent = 'Queued!';
    }).catch(err => {
      showError('Failed to queue album download: ' + err.message);
      downloadAlbumBtn.disabled = false;
    });
  });

  // Render tracks
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
              data-name="${track.name}">
        Download
      </button>
    `;
    tracksList.appendChild(trackElement);
  });

  document.getElementById('album-header').classList.remove('hidden');
  document.getElementById('tracks-container').classList.remove('hidden');
  attachDownloadListeners();
}

async function downloadWholeAlbum(album) {
  const url = album.external_urls.spotify;
  startDownload(url, 'album', { name: album.name });
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
      const albumType = e.currentTarget.dataset.albumType;

      // Remove the button after click
      e.currentTarget.remove();

      // Start the download for this track.
      startDownload(url, type, { name }, albumType);
    });
  });
}

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
  if (type === 'album') {
    apiUrl = `/api/album/download?service=${service}&url=${encodeURIComponent(url)}`;
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
