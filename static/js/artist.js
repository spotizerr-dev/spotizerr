// Import the downloadQueue singleton
import { downloadQueue } from './queue.js';

document.addEventListener('DOMContentLoaded', () => {
  const pathSegments = window.location.pathname.split('/');
  const artistId = pathSegments[pathSegments.indexOf('artist') + 1];

  if (!artistId) {
    showError('No artist ID provided.');
    return;
  }

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

  const firstAlbum = artistData.items[0];
  const artistName = firstAlbum?.artists[0]?.name || 'Unknown Artist';
  const artistImage = firstAlbum?.images[0]?.url || 'placeholder.jpg';

  document.getElementById('artist-name').innerHTML =
    `<a href="/artist/${artistId}" class="artist-link">${artistName}</a>`;
  document.getElementById('artist-stats').textContent = `${artistData.total} albums`;
  document.getElementById('artist-image').src = artistImage;

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

  // Download Whole Artist Button
  let downloadArtistBtn = document.getElementById('downloadArtistBtn');
  if (!downloadArtistBtn) {
    downloadArtistBtn = document.createElement('button');
    downloadArtistBtn.id = 'downloadArtistBtn';
    downloadArtistBtn.className = 'download-btn download-btn--main';
    downloadArtistBtn.textContent = 'Download All Discography';
    document.getElementById('artist-header').appendChild(downloadArtistBtn);
  }

  downloadArtistBtn.addEventListener('click', () => {
    document.querySelectorAll('.download-btn:not(#downloadArtistBtn)').forEach(btn => btn.remove());
    downloadArtistBtn.disabled = true;
    downloadArtistBtn.textContent = 'Queueing...';

    queueAllAlbums(artistData.items, downloadArtistBtn);
  });

  // Group albums by type
  const albumGroups = artistData.items.reduce((groups, album) => {
    const type = album.album_type.toLowerCase();
    if (!groups[type]) groups[type] = [];
    groups[type].push(album);
    return groups;
  }, {});

  // Render album groups
  const groupsContainer = document.getElementById('album-groups');
  groupsContainer.innerHTML = '';

  for (const [groupType, albums] of Object.entries(albumGroups)) {
    const groupSection = document.createElement('section');
    groupSection.className = 'album-group';
    
    groupSection.innerHTML = `
      <div class="album-group-header">
        <h3>${capitalize(groupType)}s</h3>
        <button class="download-btn download-btn--main group-download-btn" 
                data-group-type="${groupType}">
          Download All ${capitalize(groupType)}s
        </button>
      </div>
      <div class="albums-list"></div>
    `;

    const albumsContainer = groupSection.querySelector('.albums-list');
    albums.forEach(album => {
      const albumElement = document.createElement('div');
      albumElement.className = 'album-card';
      albumElement.innerHTML = `
        <a href="/album/${album.id}" class="album-link">
          <img src="${album.images[1]?.url || album.images[0]?.url || 'placeholder.jpg'}" 
               alt="Album cover" 
               class="album-cover">
        </a>
        <div class="album-info">
          <div class="album-title">${album.name}</div>
          <div class="album-artist">${album.artists.map(a => a.name).join(', ')}</div>
        </div>
        <button class="download-btn download-btn--circle" 
                data-url="${album.external_urls.spotify}" 
                data-type="album"
                data-name="${album.name}"
                title="Download">
          <img src="/static/images/download.svg" alt="Download">
        </button>
      `;
      albumsContainer.appendChild(albumElement);
    });

    groupsContainer.appendChild(groupSection);
  }

  document.getElementById('artist-header').classList.remove('hidden');
  document.getElementById('albums-container').classList.remove('hidden');
  attachDownloadListeners();
  attachGroupDownloadListeners();
}

// Helper to queue multiple albums
async function queueAllAlbums(albums, button) {
  try {
    const results = await Promise.allSettled(
      albums.map(album => 
        downloadQueue.startAlbumDownload(
          album.external_urls.spotify, 
          { name: album.name }
        )
      )
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    button.textContent = `Queued ${successful}/${albums.length} albums`;
  } catch (error) {
    button.textContent = 'Download All Albums';
    button.disabled = false;
    showError('Failed to queue some albums: ' + error.message);
  }
}

// Event listeners for group downloads
function attachGroupDownloadListeners() {
  document.querySelectorAll('.group-download-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const groupSection = e.target.closest('.album-group');
      const albums = Array.from(groupSection.querySelectorAll('.album-card'))
        .map(card => ({
          url: card.querySelector('.download-btn').dataset.url,
          name: card.querySelector('.album-title').textContent
        }));

      e.target.disabled = true;
      e.target.textContent = `Queueing ${albums.length} albums...`;

      try {
        const results = await Promise.allSettled(
          albums.map(album => 
            downloadQueue.startAlbumDownload(album.url, { name: album.name })
          )
        );

        const successful = results.filter(r => r.status === 'fulfilled').length;
        e.target.textContent = `Queued ${successful}/${albums.length} albums`;
      } catch (error) {
        e.target.textContent = `Download All ${capitalize(e.target.dataset.groupType)}s`;
        e.target.disabled = false;
        showError('Failed to queue some albums: ' + error.message);
      }
    });
  });
}

// Individual download handlers
function attachDownloadListeners() {
  document.querySelectorAll('.download-btn:not(.group-download-btn)').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const { url, name } = e.currentTarget.dataset;
      e.currentTarget.remove();
      downloadQueue.startAlbumDownload(url, { name })
        .catch(err => showError('Download failed: ' + err.message));
    });
  });
}

// UI Helpers
function showError(message) {
  const errorEl = document.getElementById('error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}