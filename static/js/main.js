// main.js
import { downloadQueue } from './queue.js';

document.addEventListener('DOMContentLoaded', () => {
    const searchButton = document.getElementById('searchButton');
    const searchInput = document.getElementById('searchInput');
    const queueIcon = document.getElementById('queueIcon');

    // Initialize queue icon
    queueIcon.addEventListener('click', () => downloadQueue.toggleVisibility());

    // Search functionality
    searchButton.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });
});

async function performSearch() {
    const query = document.getElementById('searchInput').value.trim();
    const searchType = document.getElementById('searchType').value;
    const resultsContainer = document.getElementById('resultsContainer');
    
    if (!query) {
        showError('Please enter a search term');
        return;
    }

    if (isSpotifyUrl(query)) {
        try {
            const type = getResourceTypeFromUrl(query);
            const supportedTypes = ['track', 'album', 'playlist', 'artist'];
            if (!supportedTypes.includes(type)) throw new Error('Unsupported URL type');
            
            const item = { name: `Direct URL (${type})`, external_urls: { spotify: query } };
            startDownload(query, type, item, type === 'artist' ? 'album,single,compilation' : undefined);
            document.getElementById('searchInput').value = '';
            return;
        } catch (error) {
            showError(`Invalid Spotify URL: ${error.message}`);
            return;
        }
    }

    resultsContainer.innerHTML = '<div class="loading">Searching...</div>';
    
    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&search_type=${searchType}&limit=50`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        
        const items = data.data[`${searchType}s`]?.items;
        if (!items?.length) {
            resultsContainer.innerHTML = '<div class="error">No results found</div>';
            return;
        }
        
        resultsContainer.innerHTML = items.map(item => createResultCard(item, searchType)).join('');
        attachDownloadListeners(items);
    } catch (error) {
        showError(error.message);
    }
}

function attachDownloadListeners(items) {
    document.querySelectorAll('.download-btn').forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const url = e.currentTarget.dataset.url;
            const type = e.currentTarget.dataset.type;
            const albumType = e.currentTarget.dataset.albumType;

            if (e.currentTarget.classList.contains('main-download')) {
                e.currentTarget.closest('.result-card').remove();
            } else {
                e.currentTarget.remove();
            }

            startDownload(url, type, items[index], albumType);
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
        realTime = false
    } = config;

    let service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
    let apiUrl = `/api/${type}/download?service=${service}&url=${encodeURIComponent(url)}`;

    if (type === 'artist') {
        apiUrl = `/api/artist/download?service=${service}&artist_url=${encodeURIComponent(url)}&album_type=${encodeURIComponent(albumType || 'album,single,compilation')}`;
    }

    if (fallback && service === 'spotify') {
        apiUrl += `&main=${deezer}&fallback=${spotify}`;
        apiUrl += `&quality=${deezerQuality}&fall_quality=${spotifyQuality}`;
    } else {
        const mainAccount = service === 'spotify' ? spotify : deezer;
        apiUrl += `&main=${mainAccount}&quality=${service === 'spotify' ? spotifyQuality : deezerQuality}`;
    }

    if (realTime) apiUrl += '&real_time=true';

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        downloadQueue.addDownload(item, type, data.prg_file);
    } catch (error) {
        showError('Download failed: ' + error.message);
    }
}

// UI Helper Functions
function showError(message) {
    document.getElementById('resultsContainer').innerHTML = `<div class="error">${message}</div>`;
}

function isSpotifyUrl(url) {
    return url.startsWith('https://open.spotify.com/');
}

function getResourceTypeFromUrl(url) {
    const pathParts = new URL(url).pathname.split('/');
    return pathParts[1];
}

function msToMinutesSeconds(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}:${seconds.padStart(2, '0')}`;
}

function createResultCard(item, type) {
    let imageUrl, title, subtitle, details;
    
    switch(type) {
        case 'track':
            imageUrl = item.album.images[0]?.url || '';
            title = item.name;
            subtitle = item.artists.map(a => a.name).join(', ');
            details = `
                <span>${item.album.name}</span>
                <span class="duration">${msToMinutesSeconds(item.duration_ms)}</span>
            `;
            return `
                <div class="result-card" data-id="${item.id}">
                    <div class="album-art-wrapper">
                        <img src="${imageUrl}" class="album-art" alt="${type} cover">
                    </div>
                    <div class="track-title">${title}</div>
                    <div class="track-artist">${subtitle}</div>
                    <div class="track-details">${details}</div>
                    <button class="download-btn" 
                            data-url="${item.external_urls.spotify}" 
                            data-type="${type}">
                        Download
                    </button>
                </div>
            `;
        case 'playlist':
            imageUrl = item.images[0]?.url || '';
            title = item.name;
            subtitle = item.owner.display_name;
            details = `
                <span>${item.tracks.total} tracks</span>
                <span class="duration">${item.description || 'No description'}</span>
            `;
            return `
                <div class="result-card" data-id="${item.id}">
                    <div class="album-art-wrapper">
                        <img src="${imageUrl}" class="album-art" alt="${type} cover">
                    </div>
                    <div class="track-title">${title}</div>
                    <div class="track-artist">${subtitle}</div>
                    <div class="track-details">${details}</div>
                    <button class="download-btn" 
                            data-url="${item.external_urls.spotify}" 
                            data-type="${type}">
                        Download
                    </button>
                </div>
            `;
        case 'album':
            imageUrl = item.images[0]?.url || '';
            title = item.name;
            subtitle = item.artists.map(a => a.name).join(', ');
            details = `
                <span>${item.release_date}</span>
                <span class="duration">${item.total_tracks} tracks</span>
            `;
            return `
                <div class="result-card" data-id="${item.id}">
                    <div class="album-art-wrapper">
                        <img src="${imageUrl}" class="album-art" alt="${type} cover">
                    </div>
                    <div class="track-title">${title}</div>
                    <div class="track-artist">${subtitle}</div>
                    <div class="track-details">${details}</div>
                    <button class="download-btn" 
                            data-url="${item.external_urls.spotify}" 
                            data-type="${type}">
                        Download
                    </button>
                </div>
            `;
        case 'artist':
            imageUrl = item.images && item.images.length ? item.images[0].url : '';
            title = item.name;
            subtitle = item.genres && item.genres.length ? item.genres.join(', ') : 'Unknown genres';
            details = `<span>Followers: ${item.followers?.total || 'N/A'}</span>`;
            return `
                <div class="result-card" data-id="${item.id}">
                    <div class="album-art-wrapper">
                        <img src="${imageUrl}" class="album-art" alt="${type} cover">
                    </div>
                    <div class="track-title">${title}</div>
                    <div class="track-artist">${subtitle}</div>
                    <div class="track-details">${details}</div>
                    <div class="artist-download-buttons">
                        <!-- Main Download Button -->
                        <button class="download-btn main-download" 
                                data-url="${item.external_urls.spotify}" 
                                data-type="${type}" 
                                data-album-type="album,single,compilation">
                            <svg class="download-icon" viewBox="0 0 24 24">
                                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                            </svg>
                            Download All Discography
                        </button>

                        <!-- Collapsible Options -->
                        <div class="download-options-container">
                            <button class="options-toggle" onclick="this.nextElementSibling.classList.toggle('expanded')">
                                More Options
                                <svg class="toggle-chevron" viewBox="0 0 24 24">
                                    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                                </svg>
                            </button>
                            
                            <div class="secondary-options">
                                <button class="download-btn option-btn" 
                                        data-url="${item.external_urls.spotify}" 
                                        data-type="${type}" 
                                        data-album-type="album">
                                    <img src="https://www.svgrepo.com/show/40029/vinyl-record.svg" 
                                        alt="Albums" 
                                        class="type-icon" />
                                    Albums
                                </button>

                                <button class="download-btn option-btn" 
                                        data-url="${item.external_urls.spotify}" 
                                        data-type="${type}" 
                                        data-album-type="single">
                                    <img src="https://www.svgrepo.com/show/147837/cassette.svg" 
                                        alt="Singles" 
                                        class="type-icon" />
                                    Singles
                                </button>

                                <button class="download-btn option-btn" 
                                        data-url="${item.external_urls.spotify}" 
                                        data-type="${type}" 
                                        data-album-type="compilation">
                                    <img src="https://brandeps.com/icon-download/C/Collection-icon-vector-01.svg" 
                                        alt="Compilations" 
                                        class="type-icon" />
                                    Compilations
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        default:
            title = item.name || 'Unknown';
            subtitle = '';
            details = '';
            return `
                <div class="result-card" data-id="${item.id}">
                    <div class="album-art-wrapper">
                        <img src="${imageUrl}" class="album-art" alt="${type} cover">
                    </div>
                    <div class="track-title">${title}</div>
                    <div class="track-artist">${subtitle}</div>
                    <div class="track-details">${details}</div>
                    <button class="download-btn" 
                            data-url="${item.external_urls.spotify}" 
                            data-type="${type}">
                        Download
                    </button>
                </div>
            `;
    }
}
