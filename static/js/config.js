import { downloadQueue } from './queue.js';

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

// Global variables to hold the active accounts from the config response.
let activeSpotifyAccount = '';
let activeDeezerAccount = '';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initConfig();
    setupServiceTabs();
    setupEventListeners();

    const queueIcon = document.getElementById('queueIcon');
    if (queueIcon) {
      queueIcon.addEventListener('click', () => {
        downloadQueue.toggleVisibility();
      });
    }
  } catch (error) {
    showConfigError(error.message);
  }
});

async function initConfig() {
  await loadConfig();
  await updateAccountSelectors();
  loadCredentials(currentService);
  updateFormFields();
}

function setupServiceTabs() {
  const serviceTabs = document.querySelectorAll('.tab-button');
  serviceTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      serviceTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentService = tab.dataset.service;
      loadCredentials(currentService);
      updateFormFields();
    });
  });
}

function setupEventListeners() {
  document.getElementById('credentialForm').addEventListener('submit', handleCredentialSubmit);

  // Config change listeners
  document.getElementById('fallbackToggle').addEventListener('change', saveConfig);
  document.getElementById('realTimeToggle').addEventListener('change', saveConfig);
  document.getElementById('spotifyQualitySelect').addEventListener('change', saveConfig);
  document.getElementById('deezerQualitySelect').addEventListener('change', saveConfig);

  // Update active account globals when the account selector is changed.
  document.getElementById('spotifyAccountSelect').addEventListener('change', (e) => {
    activeSpotifyAccount = e.target.value;
    saveConfig();
  });
  document.getElementById('deezerAccountSelect').addEventListener('change', (e) => {
    activeDeezerAccount = e.target.value;
    saveConfig();
  });

  // Formatting settings
  document.getElementById('customDirFormat').addEventListener('change', saveConfig);
  document.getElementById('customTrackFormat').addEventListener('change', saveConfig);

  // New: Max concurrent downloads change listener
  document.getElementById('maxConcurrentDownloads').addEventListener('change', saveConfig);
}

async function updateAccountSelectors() {
  try {
    const [spotifyResponse, deezerResponse] = await Promise.all([
      fetch('/api/credentials/spotify'),
      fetch('/api/credentials/deezer')
    ]);

    const spotifyAccounts = await spotifyResponse.json();
    const deezerAccounts = await deezerResponse.json();

    // Get the select elements
    const spotifySelect = document.getElementById('spotifyAccountSelect');
    const deezerSelect = document.getElementById('deezerAccountSelect');

    // Rebuild the Spotify selector options
    spotifySelect.innerHTML = spotifyAccounts
      .map(a => `<option value="${a}">${a}</option>`)
      .join('');

    // Use the active account loaded from the config (activeSpotifyAccount)
    if (spotifyAccounts.includes(activeSpotifyAccount)) {
      spotifySelect.value = activeSpotifyAccount;
    } else if (spotifyAccounts.length > 0) {
      spotifySelect.value = spotifyAccounts[0];
      activeSpotifyAccount = spotifyAccounts[0];
      await saveConfig();
    }

    // Rebuild the Deezer selector options
    deezerSelect.innerHTML = deezerAccounts
      .map(a => `<option value="${a}">${a}</option>`)
      .join('');

    if (deezerAccounts.includes(activeDeezerAccount)) {
      deezerSelect.value = activeDeezerAccount;
    } else if (deezerAccounts.length > 0) {
      deezerSelect.value = deezerAccounts[0];
      activeDeezerAccount = deezerAccounts[0];
      await saveConfig();
    }

    // Handle empty account lists
    [spotifySelect, deezerSelect].forEach((select, index) => {
      const accounts = index === 0 ? spotifyAccounts : deezerAccounts;
      if (accounts.length === 0) {
        select.innerHTML = '<option value="">No accounts available</option>';
        select.value = '';
      }
    });
  } catch (error) {
    showConfigError('Error updating accounts: ' + error.message);
  }
}

async function loadCredentials(service) {
  try {
    const response = await fetch(`/api/credentials/${service}`);
    renderCredentialsList(service, await response.json());
  } catch (error) {
    showConfigError(error.message);
  }
}

function renderCredentialsList(service, credentials) {
  const list = document.querySelector('.credentials-list');
  list.innerHTML = credentials
    .map(name =>
      `<div class="credential-item">
         <span>${name}</span>
         <div class="credential-actions">
           <button class="edit-btn" data-name="${name}" data-service="${service}">Edit</button>
           <button class="delete-btn" data-name="${name}" data-service="${service}">Delete</button>
         </div>
       </div>`
    )
    .join('');

  list.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', handleDeleteCredential);
  });

  list.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', handleEditCredential);
  });
}

async function handleDeleteCredential(e) {
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

    // If the deleted credential is the active account, clear the selection.
    const accountSelect = document.getElementById(`${service}AccountSelect`);
    if (accountSelect.value === name) {
      accountSelect.value = '';
      if (service === 'spotify') {
        activeSpotifyAccount = '';
      } else if (service === 'deezer') {
        activeDeezerAccount = '';
      }
      await saveConfig();
    }

    loadCredentials(service);
    await updateAccountSelectors();
  } catch (error) {
    showConfigError(error.message);
  }
}

async function handleEditCredential(e) {
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
    showConfigError(error.message);
  }
}

function updateFormFields() {
  const serviceFields = document.getElementById('serviceFields');
  serviceFields.innerHTML = serviceConfig[currentService].fields
    .map(field =>
      `<div class="form-group">
         <label>${field.label}:</label>
         <input type="${field.type}" 
                id="${field.id}" 
                name="${field.id}" 
                required
                ${field.type === 'password' ? 'autocomplete="new-password"' : ''}>
       </div>`
    )
    .join('');
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

    await updateAccountSelectors();
    await saveConfig();
    loadCredentials(service);
    resetForm();
  } catch (error) {
    showConfigError(error.message);
  }
}

function resetForm() {
  currentCredential = null;
  const nameInput = document.getElementById('credentialName');
  nameInput.value = '';
  nameInput.disabled = false;
  document.getElementById('credentialForm').reset();
}

async function saveConfig() {
  // Read active account values directly from the DOM (or from the globals which are kept in sync)
  const config = {
    spotify: document.getElementById('spotifyAccountSelect').value,
    deezer: document.getElementById('deezerAccountSelect').value,
    fallback: document.getElementById('fallbackToggle').checked,
    spotifyQuality: document.getElementById('spotifyQualitySelect').value,
    deezerQuality: document.getElementById('deezerQualitySelect').value,
    realTime: document.getElementById('realTimeToggle').checked,
    customDirFormat: document.getElementById('customDirFormat').value,
    customTrackFormat: document.getElementById('customTrackFormat').value,
    maxConcurrentDownloads: parseInt(document.getElementById('maxConcurrentDownloads').value, 10) || 3
  };

  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to save config');
    }
  } catch (error) {
    showConfigError(error.message);
  }
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Failed to load config');

    const savedConfig = await response.json();

    // Use the "spotify" and "deezer" properties from the API response to set the active accounts.
    activeSpotifyAccount = savedConfig.spotify || '';
    activeDeezerAccount = savedConfig.deezer || '';

    // (Optionally, if the account selects already exist you can set their values here,
    // but updateAccountSelectors() will rebuild the options and set the proper values.)
    const spotifySelect = document.getElementById('spotifyAccountSelect');
    const deezerSelect = document.getElementById('deezerAccountSelect');
    if (spotifySelect) spotifySelect.value = activeSpotifyAccount;
    if (deezerSelect) deezerSelect.value = activeDeezerAccount;

    // Update other configuration fields.
    document.getElementById('fallbackToggle').checked = !!savedConfig.fallback;
    document.getElementById('spotifyQualitySelect').value = savedConfig.spotifyQuality || 'NORMAL';
    document.getElementById('deezerQualitySelect').value = savedConfig.deezerQuality || 'MP3_128';
    document.getElementById('realTimeToggle').checked = !!savedConfig.realTime;
    document.getElementById('customDirFormat').value = savedConfig.customDirFormat || '%ar_album%/%album%';
    document.getElementById('customTrackFormat').value = savedConfig.customTrackFormat || '%tracknum%. %music%';
    document.getElementById('maxConcurrentDownloads').value = savedConfig.maxConcurrentDownloads || '3';
  } catch (error) {
    showConfigError('Error loading config: ' + error.message);
  }
}

function showConfigError(message) {
  const errorDiv = document.getElementById('configError');
  errorDiv.textContent = message;
  setTimeout(() => (errorDiv.textContent = ''), 3000);
}
