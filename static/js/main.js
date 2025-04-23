// main.js
import { downloadQueue } from './queue.js';

document.addEventListener('DOMContentLoaded', function() {
    // DOM elements
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const searchType = document.getElementById('searchType');
    const resultsContainer = document.getElementById('resultsContainer');
    const queueIcon = document.getElementById('queueIcon');
    const emptyState = document.getElementById('emptyState');
    const loadingResults = document.getElementById('loadingResults');

    // Initialize the queue
    if (queueIcon) {
        queueIcon.addEventListener('click', () => {
            downloadQueue.toggleVisibility();
        });
    }

    // Add event listeners
    if (searchButton) {
        searchButton.addEventListener('click', performSearch);
    }

    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                performSearch();
            }
        });

        // Auto-detect and handle pasted Spotify URLs
        searchInput.addEventListener('input', function(e) {
            const inputVal = e.target.value.trim();
            if (isSpotifyUrl(inputVal)) {
                const details = getSpotifyResourceDetails(inputVal);
                if (details) {
                    searchType.value = details.type;
                }
            }
        });
    }

    // Restore last search type if no URL override
    const savedType = localStorage.getItem('lastSearchType');
    if (savedType && ['track','album','playlist','artist'].includes(savedType)) {
      searchType.value = savedType;
    }
    // Save last selection on change
    if (searchType) {
      searchType.addEventListener('change', () => {
        localStorage.setItem('lastSearchType', searchType.value);
      });
    }

    // Check for URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q');
    const type = urlParams.get('type');

    if (query) {
        searchInput.value = query;
        if (type && ['track', 'album', 'playlist', 'artist'].includes(type)) {
            searchType.value = type;
        }
        performSearch();
    } else {
        // Show empty state if no query
        showEmptyState(true);
    }

    /**
     * Performs the search based on input values
     */
    async function performSearch() {
        const query = searchInput.value.trim();
        if (!query) return;

        // Handle direct Spotify URLs
        if (isSpotifyUrl(query)) {
            const details = getSpotifyResourceDetails(query);
            if (details && details.id) {
                // Redirect to the appropriate page
                window.location.href = `/${details.type}/${details.id}`;
                return;
            }
        }

        // Update URL without reloading page
        const newUrl = `${window.location.pathname}?q=${encodeURIComponent(query)}&type=${searchType.value}`;
        window.history.pushState({ path: newUrl }, '', newUrl);

        // Show loading state
        showEmptyState(false);
        showLoading(true);
        resultsContainer.innerHTML = '';

        try {
            const url = `/api/search?q=${encodeURIComponent(query)}&search_type=${searchType.value}&limit=40`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            
            const data = await response.json();
            
            // Hide loading indicator
            showLoading(false);
            
            // Render results
            if (data && data.items && data.items.length > 0) {
                resultsContainer.innerHTML = '';
                
                // Filter out items with null/undefined essential display parameters
                const validItems = filterValidItems(data.items, searchType.value);
                
                if (validItems.length === 0) {
                    // No valid items found after filtering
                    resultsContainer.innerHTML = `
                        <div class="empty-search-results">
                            <p>No valid results found for "${query}"</p>
                        </div>
                    `;
                    return;
                }
                
                validItems.forEach((item, index) => {
                    const cardElement = createResultCard(item, searchType.value, index);
                    
                    // Store the item data directly on the button element
                    const downloadBtn = cardElement.querySelector('.download-btn');
                    if (downloadBtn) {
                        downloadBtn.dataset.itemIndex = index;
                    }
                    
                    resultsContainer.appendChild(cardElement);
                });
                
                // Attach download handlers to the newly created cards
                attachDownloadListeners(validItems);
            } else {
                // No results found
                resultsContainer.innerHTML = `
                    <div class="empty-search-results">
                        <p>No results found for "${query}"</p>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error:', error);
            showLoading(false);
            resultsContainer.innerHTML = `
                <div class="error">
                    <p>Error searching: ${error.message}</p>
                </div>
            `;
        }
    }

    /**
     * Filters out items with null/undefined essential display parameters based on search type
     */
    function filterValidItems(items, type) {
        if (!items) return [];
        
        return items.filter(item => {
            // Skip null/undefined items
            if (!item) return false;
            
            // Skip explicit content if filter is enabled
            if (downloadQueue.isExplicitFilterEnabled() && item.explicit === true) {
                return false;
            }
            
            // Check essential parameters based on search type
            switch (type) {
                case 'track':
                    // For tracks, we need name, artists, and album
                    return (
                        item.name &&
                        item.artists && 
                        item.artists.length > 0 &&
                        item.artists[0] && 
                        item.artists[0].name &&
                        item.album && 
                        item.album.name &&
                        item.external_urls && 
                        item.external_urls.spotify
                    );
                    
                case 'album':
                    // For albums, we need name, artists, and cover image
                    return (
                        item.name &&
                        item.artists && 
                        item.artists.length > 0 &&
                        item.artists[0] && 
                        item.artists[0].name &&
                        item.external_urls && 
                        item.external_urls.spotify
                    );
                    
                case 'playlist':
                    // For playlists, we need name, owner, and tracks
                    return (
                        item.name &&
                        item.owner && 
                        item.owner.display_name &&
                        item.tracks &&
                        item.external_urls && 
                        item.external_urls.spotify
                    );
                    
                case 'artist':
                    // For artists, we need name
                    return (
                        item.name &&
                        item.external_urls && 
                        item.external_urls.spotify
                    );
                    
                default:
                    // Default case - just check if the item exists
                    return true;
            }
        });
    }

    /**
     * Attaches download handlers to result cards
     */
    function attachDownloadListeners(items) {
        document.querySelectorAll('.download-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // Get the item index from the button's dataset
                const itemIndex = parseInt(btn.dataset.itemIndex, 10);
                
                // Get the corresponding item
                const item = items[itemIndex];
                if (!item) return;
                
                const type = searchType.value;
                let url;
                
                // Determine the URL based on item type
                if (item.external_urls && item.external_urls.spotify) {
                    url = item.external_urls.spotify;
                } else if (item.href) {
                    url = item.href;
                } else {
                    showError('Could not determine download URL');
                    return;
                }
                
                // Prepare metadata for the download
                const metadata = { 
                    name: item.name || 'Unknown',
                    artist: item.artists ? item.artists[0]?.name : undefined
                };
                
                // Disable the button and update text
                btn.disabled = true;
                
                // For artist downloads, show a different message since it will queue multiple albums
                if (type === 'artist') {
                    btn.innerHTML = 'Queueing albums...';
                } else {
                    btn.innerHTML = 'Queueing...';
                }
                
                // Start the download
                startDownload(url, type, metadata, item.album ? item.album.album_type : null)
                    .then(() => {
                        // For artists, show how many albums were queued
                        if (type === 'artist') {
                            btn.innerHTML = 'Albums queued!';
                            // Open the queue automatically for artist downloads
                            downloadQueue.toggleVisibility(true);
                        } else {
                            btn.innerHTML = 'Queued!';
                        }
                    })
                    .catch((error) => {
                        btn.disabled = false;
                        btn.innerHTML = 'Download';
                        showError('Failed to queue download: ' + error.message);
                    });
            });
        });
    }

    /**
     * Starts the download process via API
     */
    async function startDownload(url, type, item, albumType) {
        if (!url || !type) {
            showError('Missing URL or type for download');
            return;
        }
        
        try {
            // Use the centralized downloadQueue.download method
            await downloadQueue.download(url, type, item, albumType);
            
            // Make the queue visible after queueing
            downloadQueue.toggleVisibility(true);
        } catch (error) {
            showError('Download failed: ' + (error.message || 'Unknown error'));
            throw error;
        }
    }

    /**
     * Shows an error message
     */
    function showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error';
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);
        
        // Auto-remove after 5 seconds
        setTimeout(() => errorDiv.remove(), 5000);
    }
    
    /**
     * Shows a success message
     */
    function showSuccess(message) {
        const successDiv = document.createElement('div');
        successDiv.className = 'success';
        successDiv.textContent = message;
        document.body.appendChild(successDiv);
        
        // Auto-remove after 5 seconds
        setTimeout(() => successDiv.remove(), 5000);
    }

    /**
     * Checks if a string is a valid Spotify URL
     */
    function isSpotifyUrl(url) {
        return url.includes('open.spotify.com') || 
               url.includes('spotify:') ||
               url.includes('link.tospotify.com');
    }

    /**
     * Extracts details from a Spotify URL
     */
    function getSpotifyResourceDetails(url) {
        // Allow optional path segments (e.g. intl-fr) before resource type
        const regex = /spotify\.com\/(?:[^\/]+\/)??(track|album|playlist|artist)\/([a-zA-Z0-9]+)/i;
        const match = url.match(regex);
        
        if (match) {
            return {
                type: match[1],
                id: match[2]
            };
        }
        return null;
    }

    /**
     * Formats milliseconds to MM:SS
     */
    function msToMinutesSeconds(ms) {
        if (!ms) return '0:00';
        
        const minutes = Math.floor(ms / 60000);
        const seconds = ((ms % 60000) / 1000).toFixed(0);
        return `${minutes}:${seconds.padStart(2, '0')}`;
    }

    /**
     * Creates a result card element
     */
    function createResultCard(item, type, index) {
        const cardElement = document.createElement('div');
        cardElement.className = 'result-card';
        
        // Set cursor to pointer for clickable cards
        cardElement.style.cursor = 'pointer';
        
        // Get the appropriate image URL
        let imageUrl = '/static/images/placeholder.jpg';
        if (item.album && item.album.images && item.album.images.length > 0) {
            imageUrl = item.album.images[0].url;
        } else if (item.images && item.images.length > 0) {
            imageUrl = item.images[0].url;
        }
        
        // Get the appropriate details based on type
        let subtitle = '';
        let details = '';
        
        switch (type) {
            case 'track':
                subtitle = item.artists ? item.artists.map(a => a.name).join(', ') : 'Unknown Artist';
                details = item.album ? `<span>${item.album.name}</span><span class="duration">${msToMinutesSeconds(item.duration_ms)}</span>` : '';
                break;
            case 'album':
                subtitle = item.artists ? item.artists.map(a => a.name).join(', ') : 'Unknown Artist';
                details = `<span>${item.total_tracks || 0} tracks</span><span>${item.release_date ? new Date(item.release_date).getFullYear() : ''}</span>`;
                break;
            case 'playlist':
                subtitle = `By ${item.owner ? item.owner.display_name : 'Unknown'}`;
                details = `<span>${item.tracks && item.tracks.total ? item.tracks.total : 0} tracks</span>`;
                break;
            case 'artist':
                subtitle = 'Artist';
                details = item.genres ? `<span>${item.genres.slice(0, 2).join(', ')}</span>` : '';
                break;
        }
        
        // Build the HTML
        cardElement.innerHTML = `
            <div class="album-art-wrapper">
                <img class="album-art" src="${imageUrl}" alt="${item.name || 'Item'}" onerror="this.src='/static/images/placeholder.jpg'">
            </div>
            <div class="track-title">${item.name || 'Unknown'}</div>
            <div class="track-artist">${subtitle}</div>
            <div class="track-details">${details}</div>
            <button class="download-btn btn-primary" data-item-index="${index}">
                <img src="/static/images/download.svg" alt="Download" /> 
                Download
            </button>
        `;
        
        // Add click event to navigate to the item's detail page
        cardElement.addEventListener('click', (e) => {
            // Don't trigger if the download button was clicked
            if (e.target.classList.contains('download-btn') || 
                e.target.parentElement.classList.contains('download-btn')) {
                return;
            }
            
            if (item.id) {
                window.location.href = `/${type}/${item.id}`;
            }
        });
        
        return cardElement;
    }

    /**
     * Show/hide the empty state
     */
    function showEmptyState(show) {
        if (emptyState) {
            emptyState.style.display = show ? 'flex' : 'none';
        }
    }

    /**
     * Show/hide the loading indicator
     */
    function showLoading(show) {
        if (loadingResults) {
            loadingResults.classList.toggle('hidden', !show);
        }
    }
});
