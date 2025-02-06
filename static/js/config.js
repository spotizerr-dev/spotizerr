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

document.addEventListener('DOMContentLoaded', () => {
  initConfig();
  setupServiceTabs();
  setupEventListeners();

  // Attach click listener for the queue icon to toggle the download queue sidebar.
  const queueIcon = document.getElementById('queueIcon');
  if (queueIcon) {
    queueIcon.addEventListener('click', () => {
      downloadQueue.toggleVisibility();
    });
  }
});

function initConfig() {
  loadConfig();
  updateAccountSelectors();
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

  // Account select changes
  document.getElementById('spotifyAccountSelect').addEventListener('change', saveConfig);
  document.getElementById('deezerAccountSelect').addEventListener('change', saveConfig);

  // New formatting settings change listeners
  document.getElementById('customDirFormat').addEventListener('change', saveConfig);
  document.getElementById('customTrackFormat').addEventListener('change', saveConfig);
}

async function updateAccountSelectors() {
  try {
    const saved = JSON.parse(localStorage.getItem('activeConfig')) || {};

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

    if (!isValidDeezer && deezerAccounts.length > 0) {
      deezerSelect.value = deezerAccounts[0];
      saved.deezer = deezerAccounts[0];
      localStorage.setItem('activeConfig', JSON.stringify(saved));
    }

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

    const accountSelect = document.getElementById(`${service}AccountSelect`);
    if (accountSelect.value === name) {
      accountSelect.value = '';
      saveConfig();
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
    // Switch to the appropriate service tab
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

    await updateAccountSelectors();
    saveConfig();
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

function saveConfig() {
  const config = {
    spotify: document.getElementById('spotifyAccountSelect').value,
    deezer: document.getElementById('deezerAccountSelect').value,
    fallback: document.getElementById('fallbackToggle').checked,
    spotifyQuality: document.getElementById('spotifyQualitySelect').value,
    deezerQuality: document.getElementById('deezerQualitySelect').value,
    realTime: document.getElementById('realTimeToggle').checked,
    // Save the new formatting settings
    customDirFormat: document.getElementById('customDirFormat').value,
    customTrackFormat: document.getElementById('customTrackFormat').value
  };
  localStorage.setItem('activeConfig', JSON.stringify(config));
}

function loadConfig() {
  const saved = JSON.parse(localStorage.getItem('activeConfig')) || {};
  document.getElementById('spotifyAccountSelect').value = saved.spotify || '';
  document.getElementById('deezerAccountSelect').value = saved.deezer || '';
  document.getElementById('fallbackToggle').checked = !!saved.fallback;
  document.getElementById('spotifyQualitySelect').value = saved.spotifyQuality || 'NORMAL';
  document.getElementById('deezerQualitySelect').value = saved.deezerQuality || 'MP3_128';
  document.getElementById('realTimeToggle').checked = !!saved.realTime;
  // Load the new formatting settings. If not set, you can choose to default to an empty string or a specific format.
  document.getElementById('customDirFormat').value = saved.customDirFormat || '';
  document.getElementById('customTrackFormat').value = saved.customTrackFormat || '';
}

function showConfigError(message) {
  const errorDiv = document.getElementById('configError');
  errorDiv.textContent = message;
  setTimeout(() => errorDiv.textContent = '', 3000);
}
