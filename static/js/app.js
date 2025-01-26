function logRequest(method, url, body = null) {
    console.log(`Sending ${method} request to: ${url}`);
    if (body) {
        console.log('Request payload:', body);
    }
}

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
            { id: 'arl', label: 'ARL', type: 'text' },
            { id: 'email', label: 'Email', type: 'email' },
            { id: 'password', label: 'Password', type: 'password' }
        ],
        validator: (data) => ({
            arl: data.arl,
            email: data.email,
            password: data.password
        })
    }
};

let currentService = 'spotify';
let currentCredential = null;

document.addEventListener('DOMContentLoaded', () => {
    const searchButton = document.getElementById('searchButton');
    const searchInput = document.getElementById('searchInput');
    const settingsIcon = document.getElementById('settingsIcon');
    const sidebar = document.getElementById('settingsSidebar');
    const closeSidebar = document.getElementById('closeSidebar');
    const serviceTabs = document.querySelectorAll('.tab-button');

    // Search functionality
    searchButton.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    // Settings functionality
    settingsIcon.addEventListener('click', () => {
        sidebar.classList.add('active');
        loadCredentials(currentService);
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

// Search functions remain the same
function performSearch() {
    const query = document.getElementById('searchInput').value.trim();
    const searchType = document.getElementById('searchType').value;
    const resultsContainer = document.getElementById('resultsContainer');
    
    if (!query) {
        showError('Please enter a search term');
        return;
    }

    resultsContainer.innerHTML = '<div class="loading">Searching...</div>';
    
    fetch(`/api/search?q=${encodeURIComponent(query)}&search_type=${searchType}&limit=30`)
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            const items = data.data[`${searchType}s`]?.items;
            
            resultsContainer.innerHTML = items?.length 
                ? items.map(item => createResultCard(item, searchType)).join('')
                : '<div class="error">No results found</div>';
        })
        .catch(error => showError(error.message));
}

function createResultCard(item, type) {
    const card = document.createElement('div');
    card.className = 'result-card';
    
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

    card.innerHTML = `
        <img src="${imageUrl}" class="album-art" alt="${type} cover">
        <div class="track-title">${title}</div>
        <div class="track-artist">${subtitle}</div>
        <div class="track-details">${details}</div>
    `;
    card.addEventListener('click', () => window.open(item.external_urls.spotify, '_blank'));
    return card;
}

// Credential management functions
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
                <button class="delete-btn" data-name="${name}">Delete</button>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            try {
                await fetch(`/api/credentials/${service}/${e.target.dataset.name}`, { method: 'DELETE' });
                loadCredentials(service);
            } catch (error) {
                showSidebarError(error.message);
            }
        });
    });

    list.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const service = e.target.dataset.service;
            const name = e.target.dataset.name;
            
            try {
                document.querySelector(`[data-service="${service}"]`).click();
                await new Promise(resolve => setTimeout(resolve, 50));
                
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
        // Validate name exists for new credentials
        if (!currentCredential && !name) {
            throw new Error('Credential name is required');
        }

        // Collect form data
        const formData = {};
        serviceConfig[service].fields.forEach(field => {
            formData[field.id] = document.getElementById(field.id).value.trim();
        });

        // Validate using service config
        const data = serviceConfig[service].validator(formData);

        // Use currentCredential for updates, name for new entries
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