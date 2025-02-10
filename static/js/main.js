// main.js
import { downloadQueue } from './queue.js';

document.addEventListener('DOMContentLoaded', () => {
    const searchButton = document.getElementById('searchButton');
    const searchInput = document.getElementById('searchInput');
    const queueIcon = document.getElementById('queueIcon');
    const searchType = document.getElementById('searchType'); // Ensure this element exists in your HTML

    // Preselect the saved search type if available
    const storedSearchType = localStorage.getItem('searchType');
    if (storedSearchType && searchType) {
        searchType.value = storedSearchType;
    }

    // Save the search type to local storage whenever it changes
    searchType.addEventListener('change', () => {
        localStorage.setItem('searchType', searchType.value);
    });

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

    // If the query is a Spotify URL for a supported resource, redirect to our route.
    if (isSpotifyUrl(query)) {
        try {
            const { type, id } = getSpotifyResourceDetails(query);
            const supportedTypes = ['track', 'album', 'playlist', 'artist'];
            if (!supportedTypes.includes(type))
                throw new Error('Unsupported URL type');
            
            // Redirect to {base_url}/{type}/{id}
            window.location.href = `${window.location.origin}/${type}/${id}`;
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
        
        // When mapping the items, include the index so that each card gets a data-index attribute.
        const items = data.data[`${searchType}s`]?.items;
        if (!items?.length) {
            resultsContainer.innerHTML = '<div class="error">No results found</div>';
            return;
        }
        
        resultsContainer.innerHTML = items
            .map((item, index) => createResultCard(item, searchType, index))
            .join('');
        attachDownloadListeners(items);
    } catch (error) {
        showError(error.message);
    }
}

/**
 * Attaches event listeners to all download buttons (both standard and small versions).
 * Instead of using the NodeList index (which can be off when multiple buttons are in one card),
 * we look up the closest result card’s data-index to get the correct item.
 */
function attachDownloadListeners(items) {
    document.querySelectorAll('.download-btn, .download-btn-small').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const url = e.currentTarget.dataset.url;
            const type = e.currentTarget.dataset.type;
            const albumType = e.currentTarget.dataset.albumType;
            // Get the parent result card and its data-index
            const card = e.currentTarget.closest('.result-card');
            const idx = card ? card.getAttribute('data-index') : null;
            const item = (idx !== null) ? items[idx] : null;

            // Remove the button or card from the UI as appropriate.
            if (e.currentTarget.classList.contains('main-download')) {
                card.remove();
            } else {
                e.currentTarget.remove();
            }
            startDownload(url, type, item, albumType);
        });
    });
}

/**
 * Calls the appropriate downloadQueue method based on the type.
 * For artists, this function will use the default parameters (which you can adjust)
 * so that the backend endpoint (at /artist/download) receives the required query parameters.
 */
async function startDownload(url, type, item, albumType) {
    // Enrich the item object with the artist property.
    if (type === 'track' || type === 'album') {
        item.artist = item.artists.map(a => a.name).join(', ');
    } else if (type === 'playlist') {
        item.artist = item.owner.display_name;
    } else if (type === 'artist') {
        item.artist = item.name;
    }
    
    try {
        if (type === 'track') {
            await downloadQueue.startTrackDownload(url, item);
        } else if (type === 'playlist') {
            await downloadQueue.startPlaylistDownload(url, item);
        } else if (type === 'album') {
            await downloadQueue.startAlbumDownload(url, item);
        } else if (type === 'artist') {
            // The downloadQueue.startArtistDownload should be implemented to call your
            // backend artist endpoint (e.g. /artist/download) with proper query parameters.
            await downloadQueue.startArtistDownload(url, item, albumType);
        } else {
            throw new Error(`Unsupported type: ${type}`);
        }
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

/**
 * Extracts the resource type and ID from a Spotify URL.
 * Expected URL format: https://open.spotify.com/{type}/{id}
 */
function getSpotifyResourceDetails(url) {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    if (pathParts.length < 3 || !pathParts[1] || !pathParts[2]) {
        throw new Error('Invalid Spotify URL');
    }
    return {
        type: pathParts[1],
        id: pathParts[2]
    };
}

function msToMinutesSeconds(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}:${seconds.padStart(2, '0')}`;
}

/**
 * Create a result card for a search result.
 * The additional parameter "index" is used to set a data-index attribute on the card.
 */
function createResultCard(item, type, index) {
    let newUrl = '#';
    try {
        const spotifyUrl = item.external_urls.spotify;
        const parsedUrl = new URL(spotifyUrl);
        newUrl = window.location.origin + parsedUrl.pathname;
    } catch (e) {
        console.error('Error parsing URL:', e);
    }

    let imageUrl, title, subtitle, details;

    switch (type) {
        case 'track':
            imageUrl = item.album.images[0]?.url || '';
            title = item.name;
            subtitle = item.artists.map(a => a.name).join(', ');
            details = `
                <span>${item.album.name}</span>
                <span class="duration">${msToMinutesSeconds(item.duration_ms)}</span>
            `;
            return `
                <div class="result-card" data-id="${item.id}" data-index="${index}">
                    <div class="album-art-wrapper">
                        <img src="${imageUrl}" class="album-art" alt="${type} cover">
                    </div>
                    <div class="title-and-view">
                        <div class="track-title">${title}</div>
                        <div class="title-buttons">
                            <button class="download-btn-small" 
                                    data-url="${item.external_urls.spotify}" 
                                    data-type="${type}" 
                                    title="Download">
                                <img src="/static/images/download.svg" alt="Download">
                            </button>
                            <button class="view-btn" onclick="window.location.href='${newUrl}'" title="View">
                                <img src="/static/images/view.svg" alt="View">
                            </button>
                        </div>
                    </div>
                    <div class="track-artist">${subtitle}</div>
                    <div class="track-details">${details}</div>
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
                <div class="result-card" data-id="${item.id}" data-index="${index}">
                    <div class="album-art-wrapper">
                        <img src="${imageUrl}" class="album-art" alt="${type} cover">
                    </div>
                    <div class="title-and-view">
                        <div class="track-title">${title}</div>
                        <div class="title-buttons">
                            <button class="download-btn-small" 
                                    data-url="${item.external_urls.spotify}" 
                                    data-type="${type}" 
                                    title="Download">
                                <img src="/static/images/download.svg" alt="Download">
                            </button>
                            <button class="view-btn" onclick="window.location.href='${newUrl}'" title="View">
                                <img src="/static/images/view.svg" alt="View">
                            </button>
                        </div>
                    </div>
                    <div class="track-artist">${subtitle}</div>
                    <div class="track-details">${details}</div>
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
                <div class="result-card" data-id="${item.id}" data-index="${index}">
                    <div class="album-art-wrapper">
                        <img src="${imageUrl}" class="album-art" alt="${type} cover">
                    </div>
                    <div class="title-and-view">
                        <div class="track-title">${title}</div>
                        <div class="title-buttons">
                            <button class="download-btn-small" 
                                    data-url="${item.external_urls.spotify}" 
                                    data-type="${type}" 
                                    title="Download">
                                <img src="/static/images/download.svg" alt="Download">
                            </button>
                            <button class="view-btn" onclick="window.location.href='${newUrl}'" title="View">
                                <img src="/static/images/view.svg" alt="View">
                            </button>
                        </div>
                    </div>
                    <div class="track-artist">${subtitle}</div>
                    <div class="track-details">${details}</div>
                </div>
            `;
        case 'artist':
            imageUrl = (item.images && item.images.length) ? item.images[0].url : '';
            title = item.name;
            subtitle = (item.genres && item.genres.length) ? item.genres.join(', ') : 'Unknown genres';
            details = `<span>Followers: ${item.followers?.total || 'N/A'}</span>`;
            return `
                <div class="result-card" data-id="${item.id}" data-index="${index}">
                    <div class="album-art-wrapper">
                        <img src="${imageUrl}" class="album-art" alt="${type} cover">
                    </div>
                    <div class="title-and-view">
                        <div class="track-title">${title}</div>
                        <div class="title-buttons">
                            <!-- A primary download button (if you want one for a “default” download) -->
                            <button class="download-btn-small" 
                                    data-url="${item.external_urls.spotify}" 
                                    data-type="${type}" 
                                    title="Download">
                                <img src="/static/images/download.svg" alt="Download">
                            </button>
                            <button class="view-btn" onclick="window.location.href='${newUrl}'" title="View">
                                <img src="/static/images/view.svg" alt="View">
                            </button>
                        </div>
                    </div>
                    <div class="track-artist">${subtitle}</div>
                    <div class="track-details">${details}</div>
                    <!-- Artist-specific download options -->
                    <div class="artist-download-buttons">
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
                <div class="result-card" data-id="${item.id}" data-index="${index}">
                    <div class="album-art-wrapper">
                        <img src="${imageUrl}" class="album-art" alt="${type} cover">
                    </div>
                    <div class="title-and-view">
                        <div class="track-title">${title}</div>
                        <div class="title-buttons">
                            <button class="download-btn-small" 
                                    data-url="${item.external_urls.spotify}" 
                                    data-type="${type}" 
                                    title="Download">
                                <img src="/static/images/download.svg" alt="Download">
                            </button>
                            <button class="view-btn" onclick="window.location.href='${newUrl}'" title="View">
                                <img src="/static/images/view.svg" alt="View">
                            </button>
                        </div>
                    </div>
                    <div class="track-artist">${subtitle}</div>
                    <div class="track-details">${details}</div>
                </div>
            `;
    }
}
