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

    // Add quality select listeners with null checks
    const spotifyQuality = document.getElementById('spotifyQualitySelect');
    if (spotifyQuality) {
        spotifyQuality.addEventListener('change', saveConfig);
    }
    
    const deezerQuality = document.getElementById('deezerQualitySelect');
    if (deezerQuality) {
        deezerQuality.addEventListener('change', saveConfig);
    }
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

    // Handle direct Spotify URLs
    if (isSpotifyUrl(query)) {
        try {
            const type = getResourceTypeFromUrl(query);
            if (!['track', 'album', 'playlist'].includes(type)) {
                throw new Error('Unsupported URL type');
            }
            
            const item = {
                name: `Direct URL (${type})`,
                external_urls: { spotify: query }
            };
            
            startDownload(query, type, item);
            document.getElementById('searchInput').value = '';
            return;
            
        } catch (error) {
            showError(`Invalid Spotify URL: ${error.message}`);
            return;
        }
    }

    // Existing search functionality
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
            
            const cards = resultsContainer.querySelectorAll('.result-card');
            cards.forEach((card, index) => {
                card.querySelector('.download-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const url = e.target.dataset.url;
                    const type = e.target.dataset.type;
                    startDownload(url, type, items[index]);
                    card.remove();
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
            break;
        case 'playlist':
            imageUrl = item.images[0]?.url || '';
            title = item.name;
            subtitle = item.owner.display_name;
            details = `
                <span>${item.tracks.total} tracks</span>
                <span class="duration">${item.description || 'No description'}</span>
            `;
            break;
        case 'album':
            imageUrl = item.images[0]?.url || '';
            title = item.name;
            subtitle = item.artists.map(a => a.name).join(', ');
            details = `
                <span>${item.release_date}</span>
                <span class="duration">${item.total_tracks} tracks</span>
            `;
            break;
    }

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
}

async function startDownload(url, type, item) {
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
  
    let apiUrl = `/api/${type}/download?service=${service}&url=${encodeURIComponent(url)}`;
    
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
            const lastLine = (await response.text()).trim();

            // Handle empty response
            if (!lastLine) {
                handleInactivity(entry, queueId, logElement);
                return;
            }

            try {
                const data = JSON.parse(lastLine);
                
                // Check for status changes
                if (JSON.stringify(entry.lastStatus) === JSON.stringify(data)) {
                    handleInactivity(entry, queueId, logElement);
                    return;
                }

                // Update entry state
                entry.lastStatus = data;
                entry.lastUpdated = Date.now();
                entry.status = data.status;
                logElement.textContent = getStatusMessage(data);

                // Handle terminal states
                if (data.status === 'error' || data.status === 'complete') {
                    handleTerminalState(entry, queueId, data);
                }

            } catch (e) {
                console.error('Invalid PRG line:', lastLine);
                logElement.textContent = 'Error parsing status update';
                handleTerminalState(entry, queueId, { 
                    status: 'error', 
                    message: 'Invalid status format' 
                });
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
    if (Date.now() - entry.lastUpdated > 180000) {
        logElement.textContent = 'Download timed out (3 minutes inactivity)';
        handleTerminalState(entry, queueId, { status: 'timeout' });
    }
}

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
    }
    
    if (data.status === 'complete') {
        setTimeout(() => cleanupEntry(queueId), 5000);
    }
    
    clearInterval(entry.intervalId);
}

function cleanupEntry(queueId) {
    const entry = downloadQueue[queueId];
    if (entry) {
        clearInterval(entry.intervalId);
        entry.element.remove();
        delete downloadQueue[queueId];
    }
}

function createQueueItem(item, type, prgFile, queueId) {
    const div = document.createElement('div');
    div.className = 'queue-item';
    div.innerHTML = `
        <div class="title">${item.name}</div>
        <div class="type">${type.charAt(0).toUpperCase() + type.slice(1)}</div>
        <div class="log" id="log-${queueId}-${prgFile}">Initializing download...</div>
    `;
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
            return `Downloading ${data.song || 'track'} by ${data.artist || 'artist'}...`;
        case 'progress':
            if (data.type === 'album') {
                return `Processing track ${data.current_track}/${data.total_tracks} (${data.percentage.toFixed(1)}%): ${data.song}`;
            } else {
                return `${data.percentage.toFixed(1)}% complete`;
            }
        case 'done':
            return `Finished: ${data.song} by ${data.artist}`;
        case 'initializing':
            return `Initializing ${data.type} download for ${data.album || data.artist}...`;
        case 'retrying':
            return `Track ${data.song} by ${data.artist} failed, retrying (${data.retries}/${data.max_retries}) in ${data.seconds_left}s`;
        case 'error':
            return `Error: ${data.message || 'Unknown error'}`;
        case 'complete':
            return 'Download completed successfully';
        case 'skipped':
            return `Track ${data.song} skipped, it already exists!`;
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
    return pathParts[1]; // Returns 'track', 'album', or 'playlist'
}
