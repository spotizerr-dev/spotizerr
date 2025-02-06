// Import the downloadQueue singleton from your working queue.js implementation.
import { downloadQueue } from './queue.js';

document.addEventListener('DOMContentLoaded', () => {
  // Parse artist ID from the URL (expected route: /artist/{id})
  const pathSegments = window.location.pathname.split('/');
  const artistId = pathSegments[pathSegments.indexOf('artist') + 1];

  if (!artistId) {
    showError('No artist ID provided.');
    return;
  }

  // Fetch the artist info (which includes a list of albums)
  fetch(`/api/artist/info?id=${encodeURIComponent(artistId)}`)
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok');
      return response.json();
    })
    .then(data => renderArtist(data, artistId))  // Pass artistId along
    .catch(error => {
      console.error('Error:', error);
      showError('Failed to load artist info.');
    });

  const queueIcon = document.getElementById('queueIcon');
  if (queueIcon) {
    queueIcon.addEventListener('click', () => {
      downloadQueue.toggleVisibility();
    });
  }
});

/**
 * Renders the artist header and groups the albums by type.
 */
function renderArtist(artistData, artistId) {
  // Hide loading and error messages
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');

  // Use the first album to extract artist details
  const firstAlbum = artistData.items[0];
  const artistName = firstAlbum?.artists[0]?.name || 'Unknown Artist';
  const artistImage = firstAlbum?.images[0]?.url || 'placeholder.jpg';

  // Embed the artist name in a link
  document.getElementById('artist-name').innerHTML =
    `<a href="/artist/${artistId}" class="artist-link">${artistName}</a>`;
  document.getElementById('artist-stats').textContent = `${artistData.total} albums`;
  document.getElementById('artist-image').src = artistImage;

  // --- Add Home Button ---
  let homeButton = document.getElementById('homeButton');
  if (!homeButton) {
    homeButton = document.createElement('button');
    homeButton.id = 'homeButton';
    homeButton.className = 'home-btn';
    homeButton.innerHTML = `<img src="/static/images/home.svg" alt="Home" class="home-icon">`;
    const headerContainer = document.getElementById('artist-header');
    headerContainer.insertBefore(homeButton, headerContainer.firstChild);
  }
  homeButton.addEventListener('click', () => {
    window.location.href = window.location.origin;
  });

  // --- Add "Download Whole Artist" Button ---
  let downloadArtistBtn = document.getElementById('downloadArtistBtn');
  if (!downloadArtistBtn) {
    downloadArtistBtn = document.createElement('button');
    downloadArtistBtn.id = 'downloadArtistBtn';
    downloadArtistBtn.textContent = 'Download Whole Artist';
    downloadArtistBtn.className = 'download-btn download-btn--main';
    const headerContainer = document.getElementById('artist-header');
    headerContainer.appendChild(downloadArtistBtn);
  }
  downloadArtistBtn.addEventListener('click', () => {
    // Remove individual album and group download buttons (but leave the whole artist button).
    document.querySelectorAll('.download-btn').forEach(btn => {
      if (btn.id !== 'downloadArtistBtn') {
        btn.remove();
      }
    });

    downloadArtistBtn.disabled = true;
    downloadArtistBtn.textContent = 'Queueing...';

    downloadWholeArtist(artistData)
      .then(() => {
        downloadArtistBtn.textContent = 'Queued!';
      })
      .catch(err => {
        showError('Failed to queue artist download: ' + err.message);
        downloadArtistBtn.disabled = false;
      });
  });

  // Group albums by album type.
  const albumGroups = {};
  artistData.items.forEach(album => {
    const type = album.album_type.toLowerCase();
    if (!albumGroups[type]) {
      albumGroups[type] = [];
    }
    albumGroups[type].push(album);
  });

  // Render groups into the #album-groups container.
  const groupsContainer = document.getElementById('album-groups');
  groupsContainer.innerHTML = ''; // Clear previous content

  // For each album type, render a section header, a "Download All" button, and the album list.
  for (const [groupType, albums] of Object.entries(albumGroups)) {
    const groupSection = document.createElement('section');
    groupSection.className = 'album-group';

    // Header with a download-all button.
    const header = document.createElement('div');
    header.className = 'album-group-header';
    header.innerHTML = `
      <h3>${capitalize(groupType)}s</h3>
      <button class="download-btn download-btn--main group-download-btn" 
              data-album-type="${groupType}" 
              data-artist-url="${firstAlbum.artists[0].external_urls.spotify}">
        Download All ${capitalize(groupType)}s
      </button>
    `;
    groupSection.appendChild(header);

    // Container for individual albums in this group.
    const albumsContainer = document.createElement('div');
    albumsContainer.className = 'albums-list';
    albums.forEach(album => {
      const albumElement = document.createElement('div');
      // Build a unified album card markup that works for both desktop and mobile.
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
                data-album-type="${album.album_type}"
                data-name="${album.name}"
                title="Download">
          <img src="/static/images/download.svg" alt="Download">
        </button>
      `;
      albumsContainer.appendChild(albumElement);
    });
    groupSection.appendChild(albumsContainer);
    groupsContainer.appendChild(groupSection);
  }

  // Reveal header and albums container.
  document.getElementById('artist-header').classList.remove('hidden');
  document.getElementById('albums-container').classList.remove('hidden');

  // Attach event listeners for individual album download buttons.
  attachDownloadListeners();
  // Attach event listeners for group download buttons.
  attachGroupDownloadListeners();
}

/**
 * Displays an error message in the UI.
 */
function showError(message) {
  const errorEl = document.getElementById('error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

/**
 * Attaches event listeners to all individual download buttons.
 */
function attachDownloadListeners() {
  document.querySelectorAll('.download-btn').forEach((btn) => {
    // Skip the whole artist and group download buttons.
    if (btn.id === 'downloadArtistBtn' || btn.classList.contains('group-download-btn')) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = e.currentTarget.dataset.url;
      const type = e.currentTarget.dataset.type;
      const name = e.currentTarget.dataset.name || extractName(url);
      const albumType = e.currentTarget.dataset.albumType;
      // Remove button after click.
      e.currentTarget.remove();
      startDownload(url, type, { name }, albumType);
    });
  });
}

/**
 * Attaches event listeners to all group download buttons.
 */
function attachGroupDownloadListeners() {
  document.querySelectorAll('.group-download-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const albumType = e.currentTarget.dataset.albumType;
      const artistUrl = e.currentTarget.dataset.artistUrl;
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = `Queueing ${capitalize(albumType)}s...`;
      startDownload(artistUrl, 'artist', { name: `All ${capitalize(albumType)}s` }, albumType)
        .then(() => {
          e.currentTarget.textContent = `Queued!`;
        })
        .catch(err => {
          showError('Failed to queue group download: ' + err.message);
          e.currentTarget.disabled = false;
        });
    });
  });
}

/**
 * Initiates the whole artist download by calling the artist endpoint.
 */
async function downloadWholeArtist(artistData) {
  const artistUrl = artistData.items[0]?.artists[0]?.external_urls.spotify;
  if (!artistUrl) throw new Error('Artist URL not found.');
  startDownload(artistUrl, 'artist', { name: artistData.items[0]?.artists[0]?.name || 'Artist' });
}

/**
 * Starts the download process by building the API URL,
 * fetching download details, and then adding the download to the queue.
 */
async function startDownload(url, type, item, albumType) {
  const config = JSON.parse(localStorage.getItem('activeConfig')) || {};
  const {
    fallback = false,
    spotify = '',
    deezer = '',
    spotifyQuality = 'NORMAL',
    deezerQuality = 'MP3_128',
    realTime = false,
    customDirFormat = '%ar_album%/%album%', // Default directory format
    customTrackFormat = '%tracknum%. %music%' // Default track format
  } = config;

  const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
  let apiUrl = '';

  if (type === 'artist') {
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

  // Add custom formatting parameters to the API request
  apiUrl += `&custom_dir_format=${encodeURIComponent(customDirFormat)}`;
  apiUrl += `&custom_track_format=${encodeURIComponent(customTrackFormat)}`;

  try {
    const response = await fetch(apiUrl);
    const data = await response.json();
    const downloadType = apiUrl.includes('/artist/download')
      ? 'artist'
      : apiUrl.includes('/album/download')
        ? 'album'
        : type;
    downloadQueue.addDownload(item, downloadType, data.prg_file);
  } catch (error) {
    showError('Download failed: ' + error.message);
  }
}

/**
 * A helper function to extract a display name from the URL.
 */
function extractName(url) {
  return url;
}

/**
 * Helper to capitalize the first letter of a string.
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
