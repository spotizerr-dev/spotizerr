const serviceConfig = {
    spotify: {
        fields: [
            { id: 'username', label: 'Username', type: 'text' },
            { id: 'credentials', label: 'Credentials', type: 'text' }
        ],
        validator: (data) => ({
            username: data.username,
            credentials: data.credentials
        })
    },
    deezer: {
        fields: [
            { id: 'arl', label: 'ARL', type: 'text' }
        ],
        validator: (data) => ({
            arl: data.arl
        })
    }
};

let currentService = 'spotify';
let currentCredential = null;
let downloadQueue = {};
let prgInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    
    const searchButton = document.getElementById('searchButton');
    const searchInput = document.getElementById('searchInput');
    const settingsIcon = document.getElementById('settingsIcon');
    const sidebar = document.getElementById('settingsSidebar');
    const closeSidebar = document.getElementById('closeSidebar');
    const serviceTabs = document.querySelectorAll('.tab-button');

    // Initialize configuration
    initConfig();

    // Search functionality
    searchButton.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    // Settings functionality
    settingsIcon.addEventListener('click', () => {
        if (sidebar.classList.contains('active')) {
            // Collapse sidebar if already expanded
            sidebar.classList.remove('active');
            resetForm();
        } else {
            // Expand sidebar and load credentials
            sidebar.classList.add('active');
            loadCredentials(currentService);
            updateFormFields();
        }
    });

    closeSidebar.addEventListener('click', () => {
        sidebar.classList.remove('active');
        resetForm();
    });

    serviceTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            serviceTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentService = tab.dataset.service;
            loadCredentials(currentService);
            updateFormFields();
        });
    });

    document.getElementById('credentialForm').addEventListener('submit', handleCredentialSubmit);
});

async function initConfig() {
    loadConfig();
    await updateAccountSelectors();
    
    // Existing listeners
    const fallbackToggle = document.getElementById('fallbackToggle');
    if (fallbackToggle) {
        fallbackToggle.addEventListener('change', () => {
            saveConfig();
            updateAccountSelectors();
        });
    }
    
    const accountSelects = ['spotifyAccountSelect', 'deezerAccountSelect'];
    accountSelects.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', () => {
                saveConfig();
                updateAccountSelectors();
            });
        }
    });

    const spotifyQuality = document.getElementById('spotifyQualitySelect');
    if (spotifyQuality) {
        spotifyQuality.addEventListener('change', saveConfig);
    }
    
    const deezerQuality = document.getElementById('deezerQualitySelect');
    if (deezerQuality) {
        deezerQuality.addEventListener('change', saveConfig);
    }

    // Load existing PRG files after initial setup
    await loadExistingPrgFiles();
} 

async function updateAccountSelectors() {
    try {
        // Get current saved configuration
        const saved = JSON.parse(localStorage.getItem('activeConfig')) || {};
        
        // Fetch available credentials
        const [spotifyResponse, deezerResponse] = await Promise.all([
            fetch('/api/credentials/spotify'),
            fetch('/api/credentials/deezer')
        ]);
        
        const spotifyAccounts = await spotifyResponse.json();
        const deezerAccounts = await deezerResponse.json();

        // Update Spotify selector
        const spotifySelect = document.getElementById('spotifyAccountSelect');
        const isValidSpotify = spotifyAccounts.includes(saved.spotify);
        spotifySelect.innerHTML = spotifyAccounts.map(a => 
            `<option value="${a}" ${a === saved.spotify ? 'selected' : ''}>${a}</option>`
        ).join('');
        
        // Validate/correct Spotify selection
        if (!isValidSpotify && spotifyAccounts.length > 0) {
            spotifySelect.value = spotifyAccounts[0];
            saved.spotify = spotifyAccounts[0];
            localStorage.setItem('activeConfig', JSON.stringify(saved));
        }

        // Update Deezer selector
        const deezerSelect = document.getElementById('deezerAccountSelect');
        const isValidDeezer = deezerAccounts.includes(saved.deezer);
        deezerSelect.innerHTML = deezerAccounts.map(a => 
            `<option value="${a}" ${a === saved.deezer ? 'selected' : ''}>${a}</option>`
        ).join('');

        // Validate/correct Deezer selection
        if (!isValidDeezer && deezerAccounts.length > 0) {
            deezerSelect.value = deezerAccounts[0];
            saved.deezer = deezerAccounts[0];
            localStorage.setItem('activeConfig', JSON.stringify(saved));
        }

        // Handle empty states
        [spotifySelect, deezerSelect].forEach((select, index) => {
            const accounts = index === 0 ? spotifyAccounts : deezerAccounts;
            if (accounts.length === 0) {
                select.innerHTML = '<option value="">No accounts available</option>';
                select.value = '';
            }
        });

    } catch (error) {
        console.error('Error updating account selectors:', error);
    }
}


function toggleDownloadQueue() {
    const queueSidebar = document.getElementById('downloadQueue');
    queueSidebar.classList.toggle('active');
}

function performSearch() {
    const query = document.getElementById('searchInput').value.trim();
    const searchType = document.getElementById('searchType').value;
    const resultsContainer = document.getElementById('resultsContainer');
    
    if (!query) {
        showError('Please enter a search term');
        return;
    }

    // Handle direct Spotify URLs for tracks, albums, playlists, and artists
    if (isSpotifyUrl(query)) {
        try {
            const type = getResourceTypeFromUrl(query);
            const supportedTypes = ['track', 'album', 'playlist', 'artist'];
            if (!supportedTypes.includes(type)) {
                throw new Error('Unsupported URL type');
            }
            
            const item = {
                name: `Direct URL (${type})`,
                external_urls: { spotify: query }
            };
            
            // For artist URLs, download all album types by default
            const albumType = type === 'artist' ? 'album,single,compilation' : undefined;
            startDownload(query, type, item, albumType);
            document.getElementById('searchInput').value = '';
            return;
            
        } catch (error) {
            showError(`Invalid Spotify URL: ${error.message}`);
            return;
        }
    }

    // Standard search
    resultsContainer.innerHTML = '<div class="loading">Searching...</div>';
    
    fetch(`/api/search?q=${encodeURIComponent(query)}&search_type=${searchType}&limit=50`)
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            const items = data.data[`${searchType}s`]?.items;
            
            if (!items || !items.length) {
                resultsContainer.innerHTML = '<div class="error">No results found</div>';
                return;
            }
            
            resultsContainer.innerHTML = items.map(item => createResultCard(item, searchType)).join('');
            
            // Attach event listeners for every download button in each card
            const cards = resultsContainer.querySelectorAll('.result-card');
            cards.forEach((card, index) => {
                card.querySelectorAll('.download-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const url = e.currentTarget.dataset.url;
                        const type = e.currentTarget.dataset.type;
                        const albumType = e.currentTarget.dataset.albumType;
            
                        // Check if the clicked button is the main download button
                        const isMainButton = e.currentTarget.classList.contains('main-download');
            
                        if (isMainButton) {
                            // Remove the entire card for main download button
                            card.remove();
                        } else {
                            // Only remove the clicked specific button
                            e.currentTarget.remove();
                        }
            
                        startDownload(url, type, items[index], albumType);
                    });
                });
            });            
        })
        .catch(error => showError(error.message));
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
                    <img src="${imageUrl}" class="album-art" alt="${type} cover">
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
                    <img src="${imageUrl}" class="album-art" alt="${type} cover">
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
                    <img src="${imageUrl}" class="album-art" alt="${type} cover">
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
                    <img src="${imageUrl}" class="album-art" alt="${type} cover">
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

async function startDownload(url, type, item, albumType) {
    const fallbackEnabled = document.getElementById('fallbackToggle').checked;
    const spotifyAccount = document.getElementById('spotifyAccountSelect').value;
    const deezerAccount = document.getElementById('deezerAccountSelect').value;
    
    // Determine service from URL
    let service;
    if (url.includes('open.spotify.com')) {
      service = 'spotify';
    } else if (url.includes('deezer.com')) {
      service = 'deezer';
    } else {
      showError('Unsupported service URL');
      return;
    }
  
    let apiUrl = '';
    if (type === 'artist') {
        // Build the API URL for artist downloads.
        // Use albumType if provided; otherwise, default to "compilation" (or you could default to "album,single,compilation")
        const albumParam = albumType || 'compilation';
        apiUrl = `/api/artist/download?service=${service}&artist_url=${encodeURIComponent(url)}&album_type=${encodeURIComponent(albumParam)}`;
    } else {
        apiUrl = `/api/${type}/download?service=${service}&url=${encodeURIComponent(url)}`;
    }
    
    // Get quality settings
    const spotifyQuality = document.getElementById('spotifyQualitySelect').value;
    const deezerQuality = document.getElementById('deezerQualitySelect').value;
  
    if (fallbackEnabled && service === 'spotify') {
      // Deezer fallback for Spotify URLs
      apiUrl += `&main=${deezerAccount}&fallback=${spotifyAccount}`;
      apiUrl += `&quality=${encodeURIComponent(deezerQuality)}`;
      apiUrl += `&fall_quality=${encodeURIComponent(spotifyQuality)}`;
    } else {
      // Standard download without fallback
      const mainAccount = service === 'spotify' ? spotifyAccount : deezerAccount;
      apiUrl += `&main=${mainAccount}`;
      apiUrl += `&quality=${encodeURIComponent(service === 'spotify' ? spotifyQuality : deezerQuality)}`;
    }
  
    // New: append real_time parameter if Real time downloading is enabled
    const realTimeEnabled = document.getElementById('realTimeToggle').checked;
    if (realTimeEnabled) {
      apiUrl += `&real_time=true`;
    }
    
    try {
      const response = await fetch(apiUrl);
      const data = await response.json();
      addToQueue(item, type, data.prg_file);
    } catch (error) {
      showError('Download failed: ' + error.message);
    }
}

function addToQueue(item, type, prgFile) {
    const queueId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const entry = {
        item,
        type,
        prgFile,
        element: createQueueItem(item, type, prgFile, queueId),
        lastStatus: null,
        lastUpdated: Date.now(),
        hasEnded: false,
        intervalId: null,
        uniqueId: queueId  // Add unique identifier
    };
    
    downloadQueue[queueId] = entry;
    document.getElementById('queueItems').appendChild(entry.element);
    startEntryMonitoring(queueId);
}

async function startEntryMonitoring(queueId) {
    const entry = downloadQueue[queueId];
    if (!entry || entry.hasEnded) return;

    entry.intervalId = setInterval(async () => {
        const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
        if (entry.hasEnded) {
            clearInterval(entry.intervalId);
            return;
        }

        try {
            const response = await fetch(`/api/prgs/${entry.prgFile}`);
            const data = await response.json();
            // data contains: { type, name, last_line }
            const progress = data.last_line;

            if (entry.type !== 'track' && progress?.type === 'track') {
                return; // Skip track-type messages for non-track downloads
            }
            // If there is no progress data, handle as inactivity.
            if (!progress) {
                handleInactivity(entry, queueId, logElement);
                return;
            }

            // Check for unchanged status to handle inactivity.
            if (JSON.stringify(entry.lastStatus) === JSON.stringify(progress)) {
                handleInactivity(entry, queueId, logElement);
                return;
            }

            // Update entry state and log.
            entry.lastStatus = progress;
            entry.lastUpdated = Date.now();
            entry.status = progress.status;
            logElement.textContent = getStatusMessage(progress);

            // Handle terminal states.
            if (progress.status === 'error' || progress.status === 'complete' || progress.status === 'cancel') {
                handleTerminalState(entry, queueId, progress);
            }
        } catch (error) {
            console.error('Status check failed:', error);
            handleTerminalState(entry, queueId, { 
                status: 'error', 
                message: 'Status check error' 
            });
        }
    }, 2000);
}



function handleInactivity(entry, queueId, logElement) {
    // Check if real time downloading is enabled
    const realTimeEnabled = document.getElementById('realTimeToggle')?.checked;
    if (realTimeEnabled) {
        // Do nothing if real time downloading is enabled (no timeout)
        return;
    }
    // Only trigger timeout if more than 3 minutes (180000 ms) of inactivity
    if (Date.now() - entry.lastUpdated > 180000) {
        logElement.textContent = 'Download timed out (3 minutes inactivity)';
        handleTerminalState(entry, queueId, { status: 'timeout' });
    }
}

// Update the handleTerminalState function to handle 'cancel' status:
function handleTerminalState(entry, queueId, data) {
    const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
    
    entry.hasEnded = true;
    entry.status = data.status;
    
    if (data.status === 'error') {
        logElement.innerHTML = `
            <span class="error-status">${getStatusMessage(data)}</span>
            <button class="retry-btn">Retry</button>
            <button class="close-btn">×</button>
        `;
        
        logElement.querySelector('.retry-btn').addEventListener('click', () => {
            startDownload(entry.item.external_urls.spotify, entry.type, entry.item);
            cleanupEntry(queueId);
        });
        
        logElement.querySelector('.close-btn').addEventListener('click', () => {
            cleanupEntry(queueId);
        });
        
        entry.element.classList.add('failed');
    } else if (data.status === 'cancel') {
        logElement.textContent = 'Download cancelled by user';
        setTimeout(() => cleanupEntry(queueId), 5000);
    } else if (data.status === 'complete') {
        setTimeout(() => cleanupEntry(queueId), 5000);
    }
    
    clearInterval(entry.intervalId);
}

function cleanupEntry(queueId) {
    const entry = downloadQueue[queueId];
    if (entry) {
        clearInterval(entry.intervalId);
        entry.element.remove();
        const prgFile = entry.prgFile;
        delete downloadQueue[queueId];
        // Send delete request for the PRG file
        fetch(`/api/prgs/delete/${encodeURIComponent(prgFile)}`, { method: 'DELETE' })
            .catch(err => console.error('Error deleting PRG file:', err));
    }
}

async function loadExistingPrgFiles() {
    try {
        const response = await fetch('/api/prgs/list');
        if (!response.ok) throw new Error('Failed to fetch PRG files');
        const prgFiles = await response.json();
        for (const prgFile of prgFiles) {
            try {
                const prgResponse = await fetch(`/api/prgs/${prgFile}`);
                const prgData = await prgResponse.json();
                // If name is empty, fallback to using the prgFile as title.
                const title = prgData.name || prgFile;
                const type = prgData.type || "unknown";
                const dummyItem = {
                    name: title,
                    external_urls: {} // You can expand this if needed.
                };
                addToQueue(dummyItem, type, prgFile);
            } catch (innerError) {
                console.error('Error processing PRG file', prgFile, ':', innerError);
            }
        }
    } catch (error) {
        console.error('Error loading existing PRG files:', error);
    }
}

function createQueueItem(item, type, prgFile, queueId) {
    const div = document.createElement('div');
    div.className = 'queue-item';
    div.innerHTML = `
        <div class="title">${item.name}</div>
        <div class="type">${type.charAt(0).toUpperCase() + type.slice(1)}</div>
        <div class="log" id="log-${queueId}-${prgFile}">Initializing download...</div>
        <button class="cancel-btn" data-prg="${prgFile}" data-type="${type}" data-queueid="${queueId}" title="Cancel Download">
            <img src="https://www.svgrepo.com/show/488384/skull-head.svg" alt="Cancel Download">
        </button>
    `;

    // Attach cancel event listener
    const cancelBtn = div.querySelector('.cancel-btn');
    cancelBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        // Hide the cancel button immediately so the user can’t click it again.
        cancelBtn.style.display = 'none';
        
        const prg = e.target.closest('button').dataset.prg;
        const type = e.target.closest('button').dataset.type;
        const queueId = e.target.closest('button').dataset.queueid;
        // Determine the correct cancel endpoint based on the type.
        // For example: `/api/album/download/cancel`, `/api/playlist/download/cancel`, `/api/track/download/cancel`, or `/api/artist/download/cancel`
        const cancelEndpoint = `/api/${type}/download/cancel?prg_file=${encodeURIComponent(prg)}`;
        try {
            const response = await fetch(cancelEndpoint);
            const data = await response.json();
            if (data.status === "cancel") {
                const logElement = document.getElementById(`log-${queueId}-${prg}`);
                logElement.textContent = "Download cancelled";
                // Mark the entry as ended and clear its monitoring interval.
                const entry = downloadQueue[queueId];
                if (entry) {
                    entry.hasEnded = true;
                    clearInterval(entry.intervalId);
                }
                // Remove the queue item after 5 seconds, same as when a download finishes.
                setTimeout(() => cleanupEntry(queueId), 5000);
            } else {
                alert("Cancel error: " + (data.error || "Unknown error"));
            }
        } catch (error) {
            alert("Cancel error: " + error.message);
        }
    });

    return div;
}




async function loadCredentials(service) {
    try {
        const response = await fetch(`/api/credentials/${service}`);
        renderCredentialsList(service, await response.json());
    } catch (error) {
        showSidebarError(error.message);
    }
}

function renderCredentialsList(service, credentials) {
    const list = document.querySelector('.credentials-list');
    list.innerHTML = credentials.map(name => `
        <div class="credential-item">
            <span>${name}</span>
            <div class="credential-actions">
                <button class="edit-btn" data-name="${name}" data-service="${service}">Edit</button>
                <button class="delete-btn" data-name="${name}" data-service="${service}">Delete</button>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            try {
                const service = e.target.dataset.service;
                const name = e.target.dataset.name;
                
                if (!service || !name) {
                    throw new Error('Missing credential information');
                }

                const response = await fetch(`/api/credentials/${service}/${name}`, { 
                    method: 'DELETE' 
                });

                if (!response.ok) {
                    throw new Error('Failed to delete credential');
                }

                // Update active account if deleted credential was selected
                const accountSelect = document.getElementById(`${service}AccountSelect`);
                if (accountSelect.value === name) {
                    accountSelect.value = '';
                    saveConfig();
                }

                // Refresh UI
                loadCredentials(service);
                await updateAccountSelectors();

            } catch (error) {
                showSidebarError(error.message);
                console.error('Delete error:', error);
            }
        });
    });

    list.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const service = e.target.dataset.service;
            const name = e.target.dataset.name;
            
            try {
                // Switch to correct service tab
                document.querySelector(`[data-service="${service}"]`).click();
                await new Promise(resolve => setTimeout(resolve, 50));
                
                // Load credential data
                const response = await fetch(`/api/credentials/${service}/${name}`);
                const data = await response.json();
                
                currentCredential = name;
                document.getElementById('credentialName').value = name;
                document.getElementById('credentialName').disabled = true;
                populateFormFields(service, data);
            } catch (error) {
                showSidebarError(error.message);
            }
        });
    });
}

function updateFormFields() {
    const serviceFields = document.getElementById('serviceFields');
    serviceFields.innerHTML = serviceConfig[currentService].fields.map(field => `
        <div class="form-group">
            <label>${field.label}:</label>
            <input type="${field.type}" 
                   id="${field.id}" 
                   name="${field.id}" 
                   required
                   ${field.type === 'password' ? 'autocomplete="new-password"' : ''}>
        </div>
    `).join('');
}

function populateFormFields(service, data) {
    serviceConfig[service].fields.forEach(field => {
        const element = document.getElementById(field.id);
        if (element) element.value = data[field.id] || '';
    });
}

async function handleCredentialSubmit(e) {
    e.preventDefault();
    const service = document.querySelector('.tab-button.active').dataset.service;
    const nameInput = document.getElementById('credentialName');
    const name = nameInput.value.trim();
    
    try {
        if (!currentCredential && !name) {
            throw new Error('Credential name is required');
        }

        const formData = {};
        serviceConfig[service].fields.forEach(field => {
            formData[field.id] = document.getElementById(field.id).value.trim();
        });

        const data = serviceConfig[service].validator(formData);
        const endpointName = currentCredential || name;
        const method = currentCredential ? 'PUT' : 'POST';
        
        const response = await fetch(`/api/credentials/${service}/${endpointName}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to save credentials');
        }

        // Refresh and persist after credential changes
        await updateAccountSelectors();
        saveConfig();
        loadCredentials(service);
        resetForm();
        
    } catch (error) {
        showSidebarError(error.message);
        console.error('Submission error:', error);
    }
}


function resetForm() {
    currentCredential = null;
    const nameInput = document.getElementById('credentialName');
    nameInput.value = '';
    nameInput.disabled = false;
    document.getElementById('credentialForm').reset();
}


// Helper functions
function msToMinutesSeconds(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}:${seconds.padStart(2, '0')}`;
}

function showError(message) {
    document.getElementById('resultsContainer').innerHTML = `<div class="error">${message}</div>`;
}

function showSidebarError(message) {
    const errorDiv = document.getElementById('sidebarError');
    errorDiv.textContent = message;
    setTimeout(() => errorDiv.textContent = '', 3000);
}

function getStatusMessage(data) {
    switch (data.status) {
      case 'downloading':
        // For track downloads only.
        if (data.type === 'track') {
          return `Downloading track "${data.song}" by ${data.artist}...`;
        }
        return `Downloading ${data.type}...`;
  
      case 'initializing':
        if (data.type === 'playlist') {
          return `Initializing playlist download "${data.name}" with ${data.total_tracks} tracks...`;
        } else if (data.type === 'album') {
          return `Initializing album download "${data.album}" by ${data.artist}...`;
        } else if (data.type === 'artist') {
          return `Initializing artist download for ${data.artist} with ${data.total_albums} album(s) [${data.album_type}]...`;
        }
        return `Initializing ${data.type} download...`;
  
      case 'progress':
        // Expect progress messages for playlists, albums (or artist’s albums) to include a "track" and "current_track".
        if (data.track && data.current_track) {
          // current_track is a string in the format "current/total"
          const parts = data.current_track.split('/');
          const current = parts[0];
          const total = parts[1] || '?';
  
          if (data.type === 'playlist') {
            return `Downloading playlist: Track ${current} of ${total} - ${data.track}`;
          } else if (data.type === 'album') {
            // For album progress, the "album" and "artist" fields may be available on a done message.
            // In some cases (like artist downloads) only track info is passed.
            if (data.album && data.artist) {
              return `Downloading album "${data.album}" by ${data.artist}: track ${current} of ${total} - ${data.track}`;
            } else {
              return `Downloading track ${current} of ${total}: ${data.track} from ${data.album}`;
            }
          }
        }
        // Fallback if fields are missing:
        return `Progress: ${data.status}...`;
  
      case 'done':
        if (data.type === 'track') {
          return `Finished track "${data.song}" by ${data.artist}`;
        } else if (data.type === 'playlist') {
          return `Finished playlist "${data.name}" with ${data.total_tracks} tracks`;
        } else if (data.type === 'album') {
          return `Finished album "${data.album}" by ${data.artist}`;
        } else if (data.type === 'artist') {
          return `Finished artist "${data.artist}" (${data.album_type})`;
        }
        return `Finished ${data.type}`;
  
      case 'retrying':
        return `Track "${data.song}" by ${data.artist}" failed, retrying (${data.retry_count}/10) in ${data.seconds_left}s`;
  
      case 'error':
        return `Error: ${data.message || 'Unknown error'}`;
  
      case 'complete':
        return 'Download completed successfully';
  
      case 'skipped':
        return `Track "${data.song}" skipped, it already exists!`;
  
      case 'real_time': {
        // Convert milliseconds to minutes and seconds.
        const totalMs = data.time_elapsed;
        const minutes = Math.floor(totalMs / 60000);
        const seconds = Math.floor((totalMs % 60000) / 1000);
        const paddedSeconds = seconds < 10 ? '0' + seconds : seconds;
        return `Real-time downloading track "${data.song}" by ${data.artist} (${(data.percentage * 100).toFixed(1)}%). Time elapsed: ${minutes}:${paddedSeconds}`;
      }
  
      default:
        return data.status;
    }
  }
  

function saveConfig() {
    const config = {
      spotify: document.getElementById('spotifyAccountSelect').value,
      deezer: document.getElementById('deezerAccountSelect').value,
      fallback: document.getElementById('fallbackToggle').checked,
      spotifyQuality: document.getElementById('spotifyQualitySelect').value,
      deezerQuality: document.getElementById('deezerQualitySelect').value,
      realTime: document.getElementById('realTimeToggle').checked  // new property
    };
    localStorage.setItem('activeConfig', JSON.stringify(config));
}

function loadConfig() {
    const saved = JSON.parse(localStorage.getItem('activeConfig')) || {};
    
    // Account selects
    const spotifySelect = document.getElementById('spotifyAccountSelect');
    if (spotifySelect) spotifySelect.value = saved.spotify || '';
    
    const deezerSelect = document.getElementById('deezerAccountSelect');
    if (deezerSelect) deezerSelect.value = saved.deezer || '';
    
    // Fallback toggle
    const fallbackToggle = document.getElementById('fallbackToggle');
    if (fallbackToggle) fallbackToggle.checked = !!saved.fallback;
    
    // Quality selects
    const spotifyQuality = document.getElementById('spotifyQualitySelect');
    if (spotifyQuality) spotifyQuality.value = saved.spotifyQuality || 'NORMAL';
    
    const deezerQuality = document.getElementById('deezerQualitySelect');
    if (deezerQuality) deezerQuality.value = saved.deezerQuality || 'MP3_128';

    // New: Real time downloading toggle
    const realTimeToggle = document.getElementById('realTimeToggle');
    if (realTimeToggle) realTimeToggle.checked = !!saved.realTime;
}

function isSpotifyUrl(url) {
    return url.startsWith('https://open.spotify.com/');
}

function getResourceTypeFromUrl(url) {
    const pathParts = new URL(url).pathname.split('/');
    return pathParts[1]; // Returns 'track', 'album', 'playlist', or 'artist'
}
