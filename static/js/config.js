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
    }),
    // Adding search credentials fields
    searchFields: [
      { id: 'client_id', label: 'Client ID', type: 'text' },
      { id: 'client_secret', label: 'Client Secret', type: 'password' }
    ],
    searchValidator: (data) => ({
      client_id: data.client_id,
      client_secret: data.client_secret
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
let isEditingSearch = false;

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

  // Max concurrent downloads change listener
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
    const response = await fetch(`/api/credentials/all/${service}`);
    if (!response.ok) {
      throw new Error(`Failed to load credentials: ${response.statusText}`);
    }
    
    const credentials = await response.json();
    renderCredentialsList(service, credentials);
  } catch (error) {
    showConfigError(error.message);
  }
}

function renderCredentialsList(service, credentials) {
  const list = document.querySelector('.credentials-list');
  list.innerHTML = '';

  if (!credentials.length) {
    list.innerHTML = '<div class="no-credentials">No accounts found. Add a new account below.</div>';
    return;
  }

  credentials.forEach(credData => {
    const credItem = document.createElement('div');
    credItem.className = 'credential-item';
    
    const hasSearchCreds = credData.search && Object.keys(credData.search).length > 0;
    
    credItem.innerHTML = `
      <div class="credential-info">
        <span class="credential-name">${credData.name}</span>
        ${service === 'spotify' ? 
          `<div class="search-credentials-status ${hasSearchCreds ? 'has-api' : 'no-api'}">
            ${hasSearchCreds ? 'API Configured' : 'No API Credentials'}
          </div>` : ''}
      </div>
      <div class="credential-actions">
        <button class="edit-btn" data-name="${credData.name}" data-service="${service}">Edit Account</button>
        ${service === 'spotify' ? 
          `<button class="edit-search-btn" data-name="${credData.name}" data-service="${service}">
            ${hasSearchCreds ? 'Edit API' : 'Add API'}
          </button>` : ''}
        <button class="delete-btn" data-name="${credData.name}" data-service="${service}">Delete</button>
      </div>
    `;
    
    list.appendChild(credItem);
  });

  // Set up event handlers
  list.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', handleDeleteCredential);
  });

  list.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      isEditingSearch = false;
      handleEditCredential(e);
    });
  });

  if (service === 'spotify') {
    list.querySelectorAll('.edit-search-btn').forEach(btn => {
      btn.addEventListener('click', handleEditSearchCredential);
    });
  }
}

async function handleDeleteCredential(e) {
  try {
    const service = e.target.dataset.service;
    const name = e.target.dataset.name;

    if (!service || !name) {
      throw new Error('Missing credential information');
    }

    if (!confirm(`Are you sure you want to delete the ${name} account?`)) {
      return;
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
    if (!response.ok) {
      throw new Error(`Failed to load credential: ${response.statusText}`);
    }
    
    const data = await response.json();

    currentCredential = name;
    document.getElementById('credentialName').value = name;
    document.getElementById('credentialName').disabled = true;
    document.getElementById('formTitle').textContent = `Edit ${service.charAt(0).toUpperCase() + service.slice(1)} Account`;
    document.getElementById('submitCredentialBtn').textContent = 'Update Account';
    
    // Show regular fields
    populateFormFields(service, data);
    toggleSearchFieldsVisibility(false);
  } catch (error) {
    showConfigError(error.message);
  }
}

async function handleEditSearchCredential(e) {
  const service = e.target.dataset.service;
  const name = e.target.dataset.name;

  try {
    if (service !== 'spotify') {
      throw new Error('Search credentials are only available for Spotify');
    }

    document.querySelector(`[data-service="${service}"]`).click();
    await new Promise(resolve => setTimeout(resolve, 50));

    isEditingSearch = true;
    currentCredential = name;
    document.getElementById('credentialName').value = name;
    document.getElementById('credentialName').disabled = true;
    document.getElementById('formTitle').textContent = `Spotify API Credentials for ${name}`;
    document.getElementById('submitCredentialBtn').textContent = 'Save API Credentials';

    // Try to load existing search credentials
    try {
      const searchResponse = await fetch(`/api/credentials/${service}/${name}?type=search`);
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        // Populate search fields
        serviceConfig[service].searchFields.forEach(field => {
          const element = document.getElementById(field.id);
          if (element) element.value = searchData[field.id] || '';
        });
      } else {
        // Clear search fields if no existing search credentials
        serviceConfig[service].searchFields.forEach(field => {
          const element = document.getElementById(field.id);
          if (element) element.value = '';
        });
      }
    } catch (error) {
      // Clear search fields if there was an error
      serviceConfig[service].searchFields.forEach(field => {
        const element = document.getElementById(field.id);
        if (element) element.value = '';
      });
    }

    // Hide regular account fields, show search fields
    toggleSearchFieldsVisibility(true);
  } catch (error) {
    showConfigError(error.message);
  }
}

function toggleSearchFieldsVisibility(showSearchFields) {
  const serviceFieldsDiv = document.getElementById('serviceFields');
  const searchFieldsDiv = document.getElementById('searchFields');
  
  if (showSearchFields) {
    serviceFieldsDiv.style.display = 'none';
    searchFieldsDiv.style.display = 'block';
  } else {
    serviceFieldsDiv.style.display = 'block';
    searchFieldsDiv.style.display = 'none';
  }
}

function updateFormFields() {
  const serviceFieldsDiv = document.getElementById('serviceFields');
  const searchFieldsDiv = document.getElementById('searchFields');
  
  // Clear any existing fields
  serviceFieldsDiv.innerHTML = '';
  searchFieldsDiv.innerHTML = '';

  // Add regular account fields
  serviceConfig[currentService].fields.forEach(field => {
    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'form-group';
    fieldDiv.innerHTML = `
      <label>${field.label}:</label>
      <input type="${field.type}" 
             id="${field.id}" 
             name="${field.id}" 
             required
             ${field.type === 'password' ? 'autocomplete="new-password"' : ''}>
    `;
    serviceFieldsDiv.appendChild(fieldDiv);
  });

  // Add search fields for Spotify
  if (currentService === 'spotify' && serviceConfig[currentService].searchFields) {
    serviceConfig[currentService].searchFields.forEach(field => {
      const fieldDiv = document.createElement('div');
      fieldDiv.className = 'form-group';
      fieldDiv.innerHTML = `
        <label>${field.label}:</label>
        <input type="${field.type}" 
               id="${field.id}" 
               name="${field.id}" 
               required
               ${field.type === 'password' ? 'autocomplete="new-password"' : ''}>
      `;
      searchFieldsDiv.appendChild(fieldDiv);
    });
  }

  // Reset form title and button text
  document.getElementById('formTitle').textContent = `Add New ${currentService.charAt(0).toUpperCase() + currentService.slice(1)} Account`;
  document.getElementById('submitCredentialBtn').textContent = 'Save Account';
  
  // Initially show regular fields, hide search fields
  toggleSearchFieldsVisibility(false);
  isEditingSearch = false;
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

    const endpointName = currentCredential || name;
    let method, data, endpoint;

    if (isEditingSearch && service === 'spotify') {
      // Handle search credentials
      const formData = {};
      serviceConfig[service].searchFields.forEach(field => {
        formData[field.id] = document.getElementById(field.id).value.trim();
      });

      data = serviceConfig[service].searchValidator(formData);
      endpoint = `/api/credentials/${service}/${endpointName}?type=search`;

      // Check if search credentials already exist for this account
      const checkResponse = await fetch(endpoint);
      method = checkResponse.ok ? 'PUT' : 'POST';
    } else {
      // Handle regular account credentials
      const formData = {};
      serviceConfig[service].fields.forEach(field => {
        formData[field.id] = document.getElementById(field.id).value.trim();
      });

      data = serviceConfig[service].validator(formData);
      endpoint = `/api/credentials/${service}/${endpointName}`;
      method = currentCredential ? 'PUT' : 'POST';
    }

    const response = await fetch(endpoint, {
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
  isEditingSearch = false;
  const nameInput = document.getElementById('credentialName');
  nameInput.value = '';
  nameInput.disabled = false;
  document.getElementById('credentialForm').reset();
  
  // Reset form title and button text
  const service = currentService.charAt(0).toUpperCase() + currentService.slice(1);
  document.getElementById('formTitle').textContent = `Add New ${service} Account`;
  document.getElementById('submitCredentialBtn').textContent = 'Save Account';
  
  // Show regular account fields, hide search fields
  toggleSearchFieldsVisibility(false);
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
  setTimeout(() => (errorDiv.textContent = ''), 5000);
}
