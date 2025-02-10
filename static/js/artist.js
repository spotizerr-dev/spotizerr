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

  downloadArtistBtn.addEventListener('click', () => {
    // Optionally remove other download buttons from individual albums.
    document.querySelectorAll('.download-btn:not(#downloadArtistBtn)').forEach(btn => btn.remove());
    downloadArtistBtn.disabled = true;
    downloadArtistBtn.textContent = 'Queueing...';

    // Queue the entire discography (albums, singles, compilations, and appears_on)
    downloadQueue.startArtistDownload(
      artistUrl,
      { name: artistName, artist: artistName },
      'album,single,compilation'
    )
      .then(() => {
        downloadArtistBtn.textContent = 'Artist queued';
      })
      .catch(err => {
        downloadArtistBtn.textContent = 'Download All Discography';
        downloadArtistBtn.disabled = false;
        showError('Failed to queue artist download: ' + err.message);
      });
  });

  // Group albums by type (album, single, compilation, etc.)
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
                data-type="${album.album_type}"
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
  // Pass the artist URL and name so the group buttons can use the artist download function
  attachGroupDownloadListeners(artistUrl, artistName);
}

// Event listeners for group downloads using the artist download function
function attachGroupDownloadListeners(artistUrl, artistName) {
  document.querySelectorAll('.group-download-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const groupType = e.target.dataset.groupType; // e.g. "album", "single", "compilation"
      e.target.disabled = true;
      e.target.textContent = `Queueing all ${capitalize(groupType)}s...`;

      try {
        // Use the artist download function with the group type filter.
        await downloadQueue.startArtistDownload(
          artistUrl,
          { name: artistName, artist: artistName },
          groupType // Only queue releases of this specific type.
        );
        e.target.textContent = `Queued all ${capitalize(groupType)}s`;
      } catch (error) {
        e.target.textContent = `Download All ${capitalize(groupType)}s`;
        e.target.disabled = false;
        showError(`Failed to queue download for all ${groupType}s: ${error.message}`);
      }
    });
  });
}

// Individual download handlers remain unchanged.
function attachDownloadListeners() {
  document.querySelectorAll('.download-btn:not(.group-download-btn)').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const { url, name, type } = e.currentTarget.dataset;
      e.currentTarget.remove();
      downloadQueue.startAlbumDownload(url, { name, type })
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
