import { downloadQueue } from './queue.js';

// Interfaces for validator data
interface SpotifyValidatorData {
  username: string;
  credentials?: string; // Credentials might be optional if only username is used as an identifier
}

interface SpotifySearchValidatorData {
  client_id: string;
  client_secret: string;
}

interface DeezerValidatorData {
  arl: string;
}

const serviceConfig: Record<string, any> = {
  spotify: {
    fields: [
      { id: 'username', label: 'Username', type: 'text' },
      { id: 'credentials', label: 'Credentials', type: 'text' } // Assuming this is password/token
    ],
    validator: (data: SpotifyValidatorData) => ({ // Typed data
      username: data.username,
      credentials: data.credentials
    }),
    // Adding search credentials fields
    searchFields: [
      { id: 'client_id', label: 'Client ID', type: 'text' },
      { id: 'client_secret', label: 'Client Secret', type: 'password' }
    ],
    searchValidator: (data: SpotifySearchValidatorData) => ({ // Typed data
      client_id: data.client_id,
      client_secret: data.client_secret
    })
  },
  deezer: {
    fields: [
      { id: 'arl', label: 'ARL', type: 'text' }
    ],
    validator: (data: DeezerValidatorData) => ({ // Typed data
      arl: data.arl
    })
  }
};

let currentService = 'spotify';
let currentCredential: string | null = null;
let isEditingSearch = false;

// Global variables to hold the active accounts from the config response.
let activeSpotifyAccount = '';
let activeDeezerAccount = '';

// Reference to the credentials form card and add button
let credentialsFormCard: HTMLElement | null = null;
let showAddAccountFormBtn: HTMLElement | null = null;
let cancelAddAccountBtn: HTMLElement | null = null;

// Helper function to manage visibility of form and add button
function setFormVisibility(showForm: boolean) {
  if (credentialsFormCard && showAddAccountFormBtn) {
    credentialsFormCard.style.display = showForm ? 'block' : 'none';
    showAddAccountFormBtn.style.display = showForm ? 'none' : 'flex'; // Assuming flex for styled button
    if (showForm) {
      resetForm(); // Reset form to "add new" state when showing for add
      const credentialNameInput = document.getElementById('credentialName') as HTMLInputElement | null;
      if(credentialNameInput) credentialNameInput.focus();
    }
  }
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Failed to load config');

    const savedConfig = await response.json();

    // Set default service selection
    const defaultServiceSelect = document.getElementById('defaultServiceSelect') as HTMLSelectElement | null;
    if (defaultServiceSelect) defaultServiceSelect.value = savedConfig.service || 'spotify';
    
    // Update the service-specific options based on selected service
    updateServiceSpecificOptions();

    // Use the "spotify" and "deezer" properties from the API response to set the active accounts.
    activeSpotifyAccount = savedConfig.spotify || '';
    activeDeezerAccount = savedConfig.deezer || '';

    // (Optionally, if the account selects already exist you can set their values here,
    // but updateAccountSelectors() will rebuild the options and set the proper values.)
    const spotifySelect = document.getElementById('spotifyAccountSelect') as HTMLSelectElement | null;
    const deezerSelect = document.getElementById('deezerAccountSelect') as HTMLSelectElement | null;
    const spotifyMessage = document.getElementById('spotifyAccountMessage') as HTMLElement | null;
    const deezerMessage = document.getElementById('deezerAccountMessage') as HTMLElement | null;
    if (spotifySelect) spotifySelect.value = activeSpotifyAccount;
    if (deezerSelect) deezerSelect.value = activeDeezerAccount;

    // Update other configuration fields.
    const fallbackToggle = document.getElementById('fallbackToggle') as HTMLInputElement | null;
    if (fallbackToggle) fallbackToggle.checked = !!savedConfig.fallback;
    const spotifyQualitySelect = document.getElementById('spotifyQualitySelect') as HTMLSelectElement | null;
    if (spotifyQualitySelect) spotifyQualitySelect.value = savedConfig.spotifyQuality || 'NORMAL';
    const deezerQualitySelect = document.getElementById('deezerQualitySelect') as HTMLSelectElement | null;
    if (deezerQualitySelect) deezerQualitySelect.value = savedConfig.deezerQuality || 'MP3_128';
    const realTimeToggle = document.getElementById('realTimeToggle') as HTMLInputElement | null;
    if (realTimeToggle) realTimeToggle.checked = !!savedConfig.realTime;
    const customDirFormat = document.getElementById('customDirFormat') as HTMLInputElement | null;
    if (customDirFormat) customDirFormat.value = savedConfig.customDirFormat || '%ar_album%/%album%';
    const customTrackFormat = document.getElementById('customTrackFormat') as HTMLInputElement | null;
    if (customTrackFormat) customTrackFormat.value = savedConfig.customTrackFormat || '%tracknum%. %music%';
    const maxConcurrentDownloads = document.getElementById('maxConcurrentDownloads') as HTMLInputElement | null;
    if (maxConcurrentDownloads) maxConcurrentDownloads.value = savedConfig.maxConcurrentDownloads || '3';
    const maxRetries = document.getElementById('maxRetries') as HTMLInputElement | null;
    if (maxRetries) maxRetries.value = savedConfig.maxRetries || '3';
    const retryDelaySeconds = document.getElementById('retryDelaySeconds') as HTMLInputElement | null;
    if (retryDelaySeconds) retryDelaySeconds.value = savedConfig.retryDelaySeconds || '5';
    const retryDelayIncrease = document.getElementById('retryDelayIncrease') as HTMLInputElement | null;
    if (retryDelayIncrease) retryDelayIncrease.value = savedConfig.retry_delay_increase || '5';
    const tracknumPaddingToggle = document.getElementById('tracknumPaddingToggle') as HTMLInputElement | null;
    if (tracknumPaddingToggle) tracknumPaddingToggle.checked = savedConfig.tracknum_padding === undefined ? true : !!savedConfig.tracknum_padding;
    
    // Update explicit filter status
    updateExplicitFilterStatus(savedConfig.explicitFilter);

    // Load watch config
    await loadWatchConfig();
  } catch (error: any) {
    showConfigError('Error loading config: ' + error.message);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initConfig();
    setupServiceTabs();
    setupEventListeners();

    // Setup for the collapsable "Add Account" form
    credentialsFormCard = document.querySelector('.credentials-form.card');
    showAddAccountFormBtn = document.getElementById('showAddAccountFormBtn');
    cancelAddAccountBtn = document.getElementById('cancelAddAccountBtn');

    if (credentialsFormCard && showAddAccountFormBtn) {
      // Initially hide form, show add button (default state handled by setFormVisibility if called)
      credentialsFormCard.style.display = 'none'; 
      showAddAccountFormBtn.style.display = 'flex'; // Assuming styled button uses flex
    }

    if (showAddAccountFormBtn) {
      showAddAccountFormBtn.addEventListener('click', () => {
        setFormVisibility(true);
      });
    }

    if (cancelAddAccountBtn && credentialsFormCard && showAddAccountFormBtn) {
      cancelAddAccountBtn.addEventListener('click', () => {
        setFormVisibility(false);
        resetForm(); // Also reset form state on cancel
      });
    }

    const queueIcon = document.getElementById('queueIcon');
    if (queueIcon) {
      queueIcon.addEventListener('click', () => {
        downloadQueue.toggleVisibility();
      });
    }

    // Attempt to set initial watchlist button visibility from cache
    const watchlistButton = document.getElementById('watchlistButton') as HTMLAnchorElement | null;
    if (watchlistButton) {
        const cachedWatchEnabled = localStorage.getItem('spotizerr_watch_enabled_cached');
        if (cachedWatchEnabled === 'true') {
            watchlistButton.classList.remove('hidden');
        }
    }

    // Fetch watch config to determine if watchlist button should be visible
    async function updateWatchlistButtonVisibility() {
      if (watchlistButton) {
          try {
              const response = await fetch('/api/config/watch');
              if (response.ok) {
                  const watchConfig = await response.json();
                  localStorage.setItem('spotizerr_watch_enabled_cached', watchConfig.enabled ? 'true' : 'false');
                  if (watchConfig && watchConfig.enabled === false) {
                      watchlistButton.classList.add('hidden');
                  } else {
                      watchlistButton.classList.remove('hidden'); // Ensure it's shown if enabled
                  }
              } else {
                  console.error('Failed to fetch watch config for config page, defaulting to hidden');
                  // Don't update cache on error
                  watchlistButton.classList.add('hidden'); // Hide if config fetch fails
              }
          } catch (error) {
              console.error('Error fetching watch config for config page:', error);
              // Don't update cache on error
              watchlistButton.classList.add('hidden'); // Hide on error
          }
      }
    }
    updateWatchlistButtonVisibility();

  } catch (error: any) {
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
      currentService = (tab as HTMLElement).dataset.service || 'spotify';
      loadCredentials(currentService);
      updateFormFields();
    });
  });
}

function setupEventListeners() {
  (document.getElementById('credentialForm') as HTMLFormElement | null)?.addEventListener('submit', handleCredentialSubmit);

  // Config change listeners
  (document.getElementById('defaultServiceSelect') as HTMLSelectElement | null)?.addEventListener('change', function() {
    updateServiceSpecificOptions();
    saveConfig();
  });
  (document.getElementById('fallbackToggle') as HTMLInputElement | null)?.addEventListener('change', saveConfig);
  (document.getElementById('realTimeToggle') as HTMLInputElement | null)?.addEventListener('change', saveConfig);
  (document.getElementById('spotifyQualitySelect') as HTMLSelectElement | null)?.addEventListener('change', saveConfig);
  (document.getElementById('deezerQualitySelect') as HTMLSelectElement | null)?.addEventListener('change', saveConfig);
  (document.getElementById('tracknumPaddingToggle') as HTMLInputElement | null)?.addEventListener('change', saveConfig);
  (document.getElementById('maxRetries') as HTMLInputElement | null)?.addEventListener('change', saveConfig);
  (document.getElementById('retryDelaySeconds') as HTMLInputElement | null)?.addEventListener('change', saveConfig);

  // Update active account globals when the account selector is changed.
  (document.getElementById('spotifyAccountSelect') as HTMLSelectElement | null)?.addEventListener('change', (e: Event) => {
    activeSpotifyAccount = (e.target as HTMLSelectElement).value;
    saveConfig();
  });
  (document.getElementById('deezerAccountSelect') as HTMLSelectElement | null)?.addEventListener('change', (e: Event) => {
    activeDeezerAccount = (e.target as HTMLSelectElement).value;
    saveConfig();
  });

  // Formatting settings
  (document.getElementById('customDirFormat') as HTMLInputElement | null)?.addEventListener('change', saveConfig);
  (document.getElementById('customTrackFormat') as HTMLInputElement | null)?.addEventListener('change', saveConfig);
  
  // Copy to clipboard when selecting placeholders
  (document.getElementById('dirFormatHelp') as HTMLSelectElement | null)?.addEventListener('change', function() {
    copyPlaceholderToClipboard(this as HTMLSelectElement);
  });
  (document.getElementById('trackFormatHelp') as HTMLSelectElement | null)?.addEventListener('change', function() {
    copyPlaceholderToClipboard(this as HTMLSelectElement);
  });

  // Max concurrent downloads change listener
  (document.getElementById('maxConcurrentDownloads') as HTMLInputElement | null)?.addEventListener('change', saveConfig);

  // Watch options listeners
  document.querySelectorAll('#watchedArtistAlbumGroupChecklist input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', saveWatchConfig);
  });
  (document.getElementById('watchPollIntervalSeconds') as HTMLInputElement | null)?.addEventListener('change', saveWatchConfig);
  (document.getElementById('watchEnabledToggle') as HTMLInputElement | null)?.addEventListener('change', () => {
    const isEnabling = (document.getElementById('watchEnabledToggle') as HTMLInputElement)?.checked;
    const alreadyShownFirstEnableNotice = localStorage.getItem('watchFeatureFirstEnableNoticeShown');

    if (isEnabling && !alreadyShownFirstEnableNotice) {
        const noticeDiv = document.getElementById('watchFeatureFirstEnableNotice');
        if (noticeDiv) noticeDiv.style.display = 'block';
        localStorage.setItem('watchFeatureFirstEnableNoticeShown', 'true');
        // Hide notice after a delay or on click if preferred
        setTimeout(() => {
            if (noticeDiv) noticeDiv.style.display = 'none';
        }, 15000); // Hide after 15 seconds
    } else {
        // If disabling, or if notice was already shown, ensure it's hidden
        const noticeDiv = document.getElementById('watchFeatureFirstEnableNotice');
        if (noticeDiv) noticeDiv.style.display = 'none';
    }
    saveWatchConfig();
    updateWatchWarningDisplay(); // Call this also when the watch enable toggle changes
  });
  (document.getElementById('realTimeToggle') as HTMLInputElement | null)?.addEventListener('change', () => {
    saveConfig();
    updateWatchWarningDisplay(); // Call this when realTimeToggle changes
  });
}

function updateServiceSpecificOptions() {
  // Get the selected service
  const selectedService = (document.getElementById('defaultServiceSelect') as HTMLSelectElement | null)?.value;

  // Handle Spotify specific options
  if (selectedService === 'spotify') {
    // Highlight Spotify section
    (document.getElementById('spotifyQualitySelect') as HTMLElement | null)?.closest('.config-item')?.classList.add('highlighted-option');
    (document.getElementById('spotifyAccountSelect') as HTMLElement | null)?.closest('.config-item')?.classList.add('highlighted-option');

    // Remove highlight from Deezer
    (document.getElementById('deezerQualitySelect') as HTMLElement | null)?.closest('.config-item')?.classList.remove('highlighted-option');
    (document.getElementById('deezerAccountSelect') as HTMLElement | null)?.closest('.config-item')?.classList.remove('highlighted-option');
  }
  // Handle Deezer specific options
  else if (selectedService === 'deezer') {
    // Highlight Deezer section
    (document.getElementById('deezerQualitySelect') as HTMLElement | null)?.closest('.config-item')?.classList.add('highlighted-option');
    (document.getElementById('deezerAccountSelect') as HTMLElement | null)?.closest('.config-item')?.classList.add('highlighted-option');

    // Remove highlight from Spotify
    (document.getElementById('spotifyQualitySelect') as HTMLElement | null)?.closest('.config-item')?.classList.remove('highlighted-option');
    (document.getElementById('spotifyAccountSelect') as HTMLElement | null)?.closest('.config-item')?.classList.remove('highlighted-option');
  }
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
    const spotifySelect = document.getElementById('spotifyAccountSelect') as HTMLSelectElement | null;
    const deezerSelect = document.getElementById('deezerAccountSelect') as HTMLSelectElement | null;
    const spotifyMessage = document.getElementById('spotifyAccountMessage') as HTMLElement | null;
    const deezerMessage = document.getElementById('deezerAccountMessage') as HTMLElement | null;

    // Rebuild the Spotify selector options
    if (spotifySelect && spotifyMessage) {
        if (spotifyAccounts.length > 0) {
            spotifySelect.innerHTML = spotifyAccounts
              .map((a: string) => `<option value="${a}">${a}</option>`)
              .join('');
            spotifySelect.style.display = '';
            spotifyMessage.style.display = 'none';

            // Use the active account loaded from the config (activeSpotifyAccount)
            if (activeSpotifyAccount && spotifyAccounts.includes(activeSpotifyAccount)) {
                spotifySelect.value = activeSpotifyAccount;
            } else {
                spotifySelect.value = spotifyAccounts[0];
                activeSpotifyAccount = spotifyAccounts[0];
                await saveConfig(); // Save if we defaulted
            }
        } else {
            spotifySelect.innerHTML = '';
            spotifySelect.style.display = 'none';
            spotifyMessage.textContent = 'No Spotify accounts available.';
            spotifyMessage.style.display = '';
            if (activeSpotifyAccount !== '') { // Clear active account if it was set
                activeSpotifyAccount = '';
                await saveConfig();
            }
        }
    }

    // Rebuild the Deezer selector options
    if (deezerSelect && deezerMessage) {
        if (deezerAccounts.length > 0) {
            deezerSelect.innerHTML = deezerAccounts
              .map((a: string) => `<option value="${a}">${a}</option>`)
              .join('');
            deezerSelect.style.display = '';
            deezerMessage.style.display = 'none';

            if (activeDeezerAccount && deezerAccounts.includes(activeDeezerAccount)) {
                deezerSelect.value = activeDeezerAccount;
            } else {
                deezerSelect.value = deezerAccounts[0];
                activeDeezerAccount = deezerAccounts[0];
                await saveConfig(); // Save if we defaulted
            }
        } else {
            deezerSelect.innerHTML = '';
            deezerSelect.style.display = 'none';
            deezerMessage.textContent = 'No Deezer accounts available.';
            deezerMessage.style.display = '';
            if (activeDeezerAccount !== '') { // Clear active account if it was set
                activeDeezerAccount = '';
                await saveConfig();
            }
        }
    }
  } catch (error: any) {
    showConfigError('Error updating accounts: ' + error.message);
  }
}

async function loadCredentials(service: string) {
  try {
    const response = await fetch(`/api/credentials/all/${service}`);
    if (!response.ok) {
      throw new Error(`Failed to load credentials: ${response.statusText}`);
    }
    
    const credentials = await response.json();
    renderCredentialsList(service, credentials);
  } catch (error: any) {
    showConfigError(error.message);
  }
}

function renderCredentialsList(service: string, credentials: any[]) {
  const list = document.querySelector('.credentials-list-items') as HTMLElement | null;
  if (!list) return;
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
    btn.addEventListener('click', handleDeleteCredential as EventListener);
  });

  list.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      isEditingSearch = false;
      handleEditCredential(e as MouseEvent);
    });
  });

  if (service === 'spotify') {
    list.querySelectorAll('.edit-search-btn').forEach(btn => {
      btn.addEventListener('click', handleEditSearchCredential as EventListener);
    });
  }
}

async function handleDeleteCredential(e: Event) {
  try {
    const target = e.target as HTMLElement;
    const service = target.dataset.service;
    const name = target.dataset.name;

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
    const accountSelect = document.getElementById(`${service}AccountSelect`) as HTMLSelectElement | null;
    if (accountSelect && accountSelect.value === name) {
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
  } catch (error: any) {
    showConfigError(error.message);
  }
}

async function handleEditCredential(e: MouseEvent) {
  const target = e.target as HTMLElement;
  const service = target.dataset.service;
  const name = target.dataset.name;

  try {
    (document.querySelector(`[data-service="${service}"]`) as HTMLElement | null)?.click();
    await new Promise(resolve => setTimeout(resolve, 50));

    setFormVisibility(true); // Show form for editing, will hide add button

    const response = await fetch(`/api/credentials/${service}/${name}`);
    if (!response.ok) {
      throw new Error(`Failed to load credential: ${response.statusText}`);
    }
    
    const data = await response.json();

    currentCredential = name ? name : null;
    const credentialNameInput = document.getElementById('credentialName') as HTMLInputElement | null;
    if (credentialNameInput) {
        credentialNameInput.value = name || '';
        credentialNameInput.disabled = true;
    }
    (document.getElementById('formTitle') as HTMLElement | null)!.textContent = `Edit ${service!.charAt(0).toUpperCase() + service!.slice(1)} Account`;
    (document.getElementById('submitCredentialBtn') as HTMLElement | null)!.textContent = 'Update Account';
    
    // Show regular fields
    populateFormFields(service!, data);
    toggleSearchFieldsVisibility(false);
  } catch (error: any) {
    showConfigError(error.message);
  }
}

async function handleEditSearchCredential(e: Event) {
  const target = e.target as HTMLElement;
  const service = target.dataset.service;
  const name = target.dataset.name;

  try {
    if (service !== 'spotify') {
      throw new Error('Search credentials are only available for Spotify');
    }

    setFormVisibility(true); // Show form for editing search creds, will hide add button

    (document.querySelector(`[data-service="${service}"]`) as HTMLElement | null)?.click();
    await new Promise(resolve => setTimeout(resolve, 50));

    isEditingSearch = true;
    currentCredential = name ? name : null;
    const credentialNameInput = document.getElementById('credentialName') as HTMLInputElement | null;
    if (credentialNameInput) {
        credentialNameInput.value = name || '';
        credentialNameInput.disabled = true;
    }
    (document.getElementById('formTitle')as HTMLElement | null)!.textContent = `Spotify API Credentials for ${name}`;
    (document.getElementById('submitCredentialBtn') as HTMLElement | null)!.textContent = 'Save API Credentials';

    // Try to load existing search credentials
    try {
      const searchResponse = await fetch(`/api/credentials/${service}/${name}?type=search`);
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        // Populate search fields
        serviceConfig[service].searchFields.forEach((field: { id: string; }) => {
          const element = document.getElementById(field.id) as HTMLInputElement | null;
          if (element) element.value = searchData[field.id] || '';
        });
      } else {
        // Clear search fields if no existing search credentials
        serviceConfig[service].searchFields.forEach((field: { id: string; }) => {
          const element = document.getElementById(field.id) as HTMLInputElement | null;
          if (element) element.value = '';
        });
      }
    } catch (error) {
      // Clear search fields if there was an error
      serviceConfig[service].searchFields.forEach((field: { id: string; }) => {
        const element = document.getElementById(field.id) as HTMLInputElement | null;
        if (element) element.value = '';
      });
    }

    // Hide regular account fields, show search fields
    toggleSearchFieldsVisibility(true);
  } catch (error: any) {
    showConfigError(error.message);
  }
}

function toggleSearchFieldsVisibility(showSearchFields: boolean) {
  const serviceFieldsDiv = document.getElementById('serviceFields') as HTMLElement | null;
  const searchFieldsDiv = document.getElementById('searchFields') as HTMLElement | null;
  
  if (showSearchFields) {
    // Hide regular fields and remove 'required' attribute
    if(serviceFieldsDiv) serviceFieldsDiv.style.display = 'none';
    // Remove required attribute from service fields
    serviceConfig[currentService].fields.forEach((field: { id: string }) => {
      const input = document.getElementById(field.id) as HTMLInputElement | null;
      if (input) input.removeAttribute('required');
    });
    
    // Show search fields and add 'required' attribute
    if(searchFieldsDiv) searchFieldsDiv.style.display = 'block';
    // Make search fields required
    if (currentService === 'spotify' && serviceConfig[currentService].searchFields) {
      serviceConfig[currentService].searchFields.forEach((field: { id: string }) => {
        const input = document.getElementById(field.id) as HTMLInputElement | null;
        if (input) input.setAttribute('required', '');
      });
    }
  } else {
    // Show regular fields and add 'required' attribute
    if(serviceFieldsDiv) serviceFieldsDiv.style.display = 'block';
    // Make service fields required
    serviceConfig[currentService].fields.forEach((field: { id: string }) => {
      const input = document.getElementById(field.id) as HTMLInputElement | null;
      if (input) input.setAttribute('required', '');
    });
    
    // Hide search fields and remove 'required' attribute
    if(searchFieldsDiv) searchFieldsDiv.style.display = 'none';
    // Remove required from search fields
    if (currentService === 'spotify' && serviceConfig[currentService].searchFields) {
      serviceConfig[currentService].searchFields.forEach((field: { id: string }) => {
        const input = document.getElementById(field.id) as HTMLInputElement | null;
        if (input) input.removeAttribute('required');
      });
    }
  }
}

function updateFormFields() {
  const serviceFieldsDiv = document.getElementById('serviceFields') as HTMLElement | null;
  const searchFieldsDiv = document.getElementById('searchFields') as HTMLElement | null;
  
  // Clear any existing fields
  if(serviceFieldsDiv) serviceFieldsDiv.innerHTML = '';
  if(searchFieldsDiv) searchFieldsDiv.innerHTML = '';

  // Add regular account fields
  serviceConfig[currentService].fields.forEach((field: { className: string; label: string; type: string; id: string; }) => {
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
    serviceFieldsDiv?.appendChild(fieldDiv);
  });

  // Add search fields for Spotify
  if (currentService === 'spotify' && serviceConfig[currentService].searchFields) {
    serviceConfig[currentService].searchFields.forEach((field: { className: string; label: string; type: string; id: string; }) => {
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
      searchFieldsDiv?.appendChild(fieldDiv);
    });
  }

  // Reset form title and button text
  (document.getElementById('formTitle') as HTMLElement | null)!.textContent = `Add New ${currentService.charAt(0).toUpperCase() + currentService.slice(1)} Account`;
  (document.getElementById('submitCredentialBtn') as HTMLElement | null)!.textContent = 'Save Account';
  
  // Initially show regular fields, hide search fields
  toggleSearchFieldsVisibility(false);
  isEditingSearch = false;
}

function populateFormFields(service: string, data: Record<string, string>) {
  serviceConfig[service].fields.forEach((field: { id: string; }) => {
    const element = document.getElementById(field.id) as HTMLInputElement | null;
    if (element) element.value = data[field.id] || '';
  });
}

async function handleCredentialSubmit(e: Event) {
  e.preventDefault();
  const service = (document.querySelector('.tab-button.active') as HTMLElement | null)?.dataset.service;
  const nameInput = document.getElementById('credentialName') as HTMLInputElement | null;
  const name = nameInput?.value.trim();

  try {
    if (!currentCredential && !name) {
      throw new Error('Credential name is required');
    }
    if (!service) {
      throw new Error('Service not selected');
    }

    const endpointName = currentCredential || name;
    let method: string, data: any, endpoint: string;

    if (isEditingSearch && service === 'spotify') {
      // Handle search credentials
      const formData: Record<string, string> = {};
      let isValid = true;
      let firstInvalidField: HTMLInputElement | null = null;
      
      // Manually validate search fields
      serviceConfig[service!].searchFields.forEach((field: { id: string; }) => {
        const input = document.getElementById(field.id) as HTMLInputElement | null;
        const value = input ? input.value.trim() : '';
        formData[field.id] = value;
        
        if (!value) {
          isValid = false;
          if (!firstInvalidField && input) firstInvalidField = input;
        }
      });
      
      if (!isValid) {
        if (firstInvalidField) (firstInvalidField as HTMLInputElement).focus();
        throw new Error('All fields are required');
      }

      data = serviceConfig[service!].searchValidator(formData);
      endpoint = `/api/credentials/${service}/${endpointName}?type=search`;

      // Check if search credentials already exist for this account
      const checkResponse = await fetch(endpoint);
      method = checkResponse.ok ? 'PUT' : 'POST';
    } else {
      // Handle regular account credentials
      const formData: Record<string, string> = {};
      let isValid = true;
      let firstInvalidField: HTMLInputElement | null = null;
      
      // Manually validate account fields
      serviceConfig[service!].fields.forEach((field: { id: string; }) => {
        const input = document.getElementById(field.id) as HTMLInputElement | null;
        const value = input ? input.value.trim() : '';
        formData[field.id] = value;
        
        if (!value) {
          isValid = false;
          if (!firstInvalidField && input) firstInvalidField = input;
        }
      });
      
      if (!isValid) {
        if (firstInvalidField) (firstInvalidField as HTMLInputElement).focus();
        throw new Error('All fields are required');
      }

      data = serviceConfig[service!].validator(formData);
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
    loadCredentials(service!);
    
    // Show success message
    showConfigSuccess(isEditingSearch ? 'API credentials saved successfully' : 'Account saved successfully');
    
    // Add a delay before hiding the form
    setTimeout(() => {
      setFormVisibility(false); // Hide form and show add button on successful submission
    }, 2000); // 2 second delay
  } catch (error: any) {
    showConfigError(error.message);
  }
}

function resetForm() {
  currentCredential = null;
  isEditingSearch = false;
  const nameInput = document.getElementById('credentialName') as HTMLInputElement | null;
  if (nameInput) {
    nameInput.value = '';
    nameInput.disabled = false;
  }
  (document.getElementById('credentialForm') as HTMLFormElement | null)?.reset();
  
  // Reset form title and button text
  const serviceName = currentService.charAt(0).toUpperCase() + currentService.slice(1);
  (document.getElementById('formTitle') as HTMLElement | null)!.textContent = `Add New ${serviceName} Account`;
  (document.getElementById('submitCredentialBtn') as HTMLElement | null)!.textContent = 'Save Account';
  
  // Show regular account fields, hide search fields
  toggleSearchFieldsVisibility(false);
}

async function saveConfig() {
  // Read active account values directly from the DOM (or from the globals which are kept in sync)
  const config = {
    service: (document.getElementById('defaultServiceSelect') as HTMLSelectElement | null)?.value,
    spotify: (document.getElementById('spotifyAccountSelect') as HTMLSelectElement | null)?.value,
    deezer: (document.getElementById('deezerAccountSelect') as HTMLSelectElement | null)?.value,
    fallback: (document.getElementById('fallbackToggle') as HTMLInputElement | null)?.checked,
    spotifyQuality: (document.getElementById('spotifyQualitySelect') as HTMLSelectElement | null)?.value,
    deezerQuality: (document.getElementById('deezerQualitySelect') as HTMLSelectElement | null)?.value,
    realTime: (document.getElementById('realTimeToggle') as HTMLInputElement | null)?.checked,
    customDirFormat: (document.getElementById('customDirFormat') as HTMLInputElement | null)?.value,
    customTrackFormat: (document.getElementById('customTrackFormat') as HTMLInputElement | null)?.value,
    maxConcurrentDownloads: parseInt((document.getElementById('maxConcurrentDownloads') as HTMLInputElement | null)?.value || '3', 10) || 3,
    maxRetries: parseInt((document.getElementById('maxRetries') as HTMLInputElement | null)?.value || '3', 10) || 3,
    retryDelaySeconds: parseInt((document.getElementById('retryDelaySeconds') as HTMLInputElement | null)?.value || '5', 10) || 5,
    retry_delay_increase: parseInt((document.getElementById('retryDelayIncrease') as HTMLInputElement | null)?.value || '5', 10) || 5,
    tracknum_padding: (document.getElementById('tracknumPaddingToggle') as HTMLInputElement | null)?.checked
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

    const savedConfig = await response.json();

    // Set default service selection
    const defaultServiceSelect = document.getElementById('defaultServiceSelect') as HTMLSelectElement | null;
    if (defaultServiceSelect) defaultServiceSelect.value = savedConfig.service || 'spotify';
    
    // Update the service-specific options based on selected service
    updateServiceSpecificOptions();

    // Use the "spotify" and "deezer" properties from the API response to set the active accounts.
    activeSpotifyAccount = savedConfig.spotify || '';
    activeDeezerAccount = savedConfig.deezer || '';

    // (Optionally, if the account selects already exist you can set their values here,
    // but updateAccountSelectors() will rebuild the options and set the proper values.)
    const spotifySelect = document.getElementById('spotifyAccountSelect') as HTMLSelectElement | null;
    const deezerSelect = document.getElementById('deezerAccountSelect') as HTMLSelectElement | null;
    if (spotifySelect) spotifySelect.value = activeSpotifyAccount;
    if (deezerSelect) deezerSelect.value = activeDeezerAccount;

    // Update other configuration fields.
    const fallbackToggle = document.getElementById('fallbackToggle') as HTMLInputElement | null;
    if (fallbackToggle) fallbackToggle.checked = !!savedConfig.fallback;
    const spotifyQualitySelect = document.getElementById('spotifyQualitySelect') as HTMLSelectElement | null;
    if (spotifyQualitySelect) spotifyQualitySelect.value = savedConfig.spotifyQuality || 'NORMAL';
    const deezerQualitySelect = document.getElementById('deezerQualitySelect') as HTMLSelectElement | null;
    if (deezerQualitySelect) deezerQualitySelect.value = savedConfig.deezerQuality || 'MP3_128';
    const realTimeToggle = document.getElementById('realTimeToggle') as HTMLInputElement | null;
    if (realTimeToggle) realTimeToggle.checked = !!savedConfig.realTime;
    const customDirFormat = document.getElementById('customDirFormat') as HTMLInputElement | null;
    if (customDirFormat) customDirFormat.value = savedConfig.customDirFormat || '%ar_album%/%album%';
    const customTrackFormat = document.getElementById('customTrackFormat') as HTMLInputElement | null;
    if (customTrackFormat) customTrackFormat.value = savedConfig.customTrackFormat || '%tracknum%. %music%';
    const maxConcurrentDownloads = document.getElementById('maxConcurrentDownloads') as HTMLInputElement | null;
    if (maxConcurrentDownloads) maxConcurrentDownloads.value = savedConfig.maxConcurrentDownloads || '3';
    const maxRetries = document.getElementById('maxRetries') as HTMLInputElement | null;
    if (maxRetries) maxRetries.value = savedConfig.maxRetries || '3';
    const retryDelaySeconds = document.getElementById('retryDelaySeconds') as HTMLInputElement | null;
    if (retryDelaySeconds) retryDelaySeconds.value = savedConfig.retryDelaySeconds || '5';
    const retryDelayIncrease = document.getElementById('retryDelayIncrease') as HTMLInputElement | null;
    if (retryDelayIncrease) retryDelayIncrease.value = savedConfig.retry_delay_increase || '5';
    const tracknumPaddingToggle = document.getElementById('tracknumPaddingToggle') as HTMLInputElement | null;
    if (tracknumPaddingToggle) tracknumPaddingToggle.checked = savedConfig.tracknum_padding === undefined ? true : !!savedConfig.tracknum_padding;
    
    // Update explicit filter status
    updateExplicitFilterStatus(savedConfig.explicitFilter);

    // Load watch config
    await loadWatchConfig();
  } catch (error: any) {
    showConfigError('Error loading config: ' + error.message);
  }
}

function updateExplicitFilterStatus(isEnabled: boolean) {
  const statusElement = document.getElementById('explicitFilterStatus');
  if (statusElement) {
    // Remove existing classes
    statusElement.classList.remove('enabled', 'disabled');
    
    // Add appropriate class and text based on whether filter is enabled
    if (isEnabled) {
      statusElement.textContent = 'Enabled';
      statusElement.classList.add('enabled');
    } else {
      statusElement.textContent = 'Disabled';
      statusElement.classList.add('disabled');
    }
  }
}

function showConfigError(message: string) {
  const errorDiv = document.getElementById('configError');
  if (errorDiv) errorDiv.textContent = message;
  setTimeout(() => { if (errorDiv) errorDiv.textContent = '' }, 5000);
}

function showConfigSuccess(message: string) {
  const successDiv = document.getElementById('configSuccess');
  if (successDiv) successDiv.textContent = message;
  setTimeout(() => { if (successDiv) successDiv.textContent = '' }, 5000);
}

// Function to copy the selected placeholder to clipboard
function copyPlaceholderToClipboard(select: HTMLSelectElement) {
  const placeholder = select.value;
  
  if (!placeholder) return; // If nothing selected
  
  // Copy to clipboard
  navigator.clipboard.writeText(placeholder)
    .then(() => {
      // Show success notification
      showCopyNotification(`Copied ${placeholder} to clipboard`);
      
      // Reset select to default after a short delay
      setTimeout(() => {
        select.selectedIndex = 0;
      }, 500);
    })
    .catch(err => {
      console.error('Failed to copy: ', err);
    });
}

// Function to show a notification when copying
function showCopyNotification(message: string) {
  // Check if notification container exists, create if not
  let notificationContainer = document.getElementById('copyNotificationContainer');
  if (!notificationContainer) {
    notificationContainer = document.createElement('div');
    notificationContainer.id = 'copyNotificationContainer';
    document.body.appendChild(notificationContainer);
  }
  
  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'copy-notification';
  notification.textContent = message;
  
  // Add to container
  notificationContainer.appendChild(notification);
  
  // Trigger animation
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  // Remove after animation completes
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      notificationContainer.removeChild(notification);
    }, 300);
  }, 2000);
}

async function loadWatchConfig() {
  try {
    const response = await fetch('/api/config/watch');
    if (!response.ok) throw new Error('Failed to load watch config');
    const watchConfig = await response.json();

    const checklistContainer = document.getElementById('watchedArtistAlbumGroupChecklist');
    if (checklistContainer && watchConfig.watchedArtistAlbumGroup) {
      const checkboxes = checklistContainer.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
      checkboxes.forEach(checkbox => {
        checkbox.checked = watchConfig.watchedArtistAlbumGroup.includes(checkbox.value);
      });
    }

    const watchPollIntervalSecondsInput = document.getElementById('watchPollIntervalSeconds') as HTMLInputElement | null;
    if (watchPollIntervalSecondsInput) {
      watchPollIntervalSecondsInput.value = watchConfig.watchPollIntervalSeconds || '3600';
    }

    const watchEnabledToggle = document.getElementById('watchEnabledToggle') as HTMLInputElement | null;
    if (watchEnabledToggle) {
      watchEnabledToggle.checked = !!watchConfig.enabled;
    }

    // Call this after the state of the toggles has been set based on watchConfig
    updateWatchWarningDisplay();

  } catch (error: any) {
    showConfigError('Error loading watch config: ' + error.message);
  }
}

async function saveWatchConfig() {
  const checklistContainer = document.getElementById('watchedArtistAlbumGroupChecklist');
  const selectedGroups: string[] = [];
  if (checklistContainer) {
    const checkedBoxes = checklistContainer.querySelectorAll('input[type="checkbox"]:checked') as NodeListOf<HTMLInputElement>;
    checkedBoxes.forEach(checkbox => selectedGroups.push(checkbox.value));
  }

  const watchConfig = {
    enabled: (document.getElementById('watchEnabledToggle') as HTMLInputElement | null)?.checked,
    watchedArtistAlbumGroup: selectedGroups,
    watchPollIntervalSeconds: parseInt((document.getElementById('watchPollIntervalSeconds') as HTMLInputElement | null)?.value || '3600', 10) || 3600,
  };

  try {
    const response = await fetch('/api/config/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(watchConfig)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to save watch config');
    }
    showConfigSuccess('Watch settings saved successfully.');
  } catch (error: any) {
    showConfigError('Error saving watch config: ' + error.message);
  }
}

// New function to manage the warning display
function updateWatchWarningDisplay() {
  const watchEnabledToggle = document.getElementById('watchEnabledToggle') as HTMLInputElement | null;
  const realTimeToggle = document.getElementById('realTimeToggle') as HTMLInputElement | null;
  const warningDiv = document.getElementById('watchEnabledWarning') as HTMLElement | null;

  if (watchEnabledToggle && realTimeToggle && warningDiv) {
    const isWatchEnabled = watchEnabledToggle.checked;
    const isRealTimeEnabled = realTimeToggle.checked;

    if (isWatchEnabled && !isRealTimeEnabled) {
      warningDiv.style.display = 'block';
    } else {
      warningDiv.style.display = 'none';
    }
  }
  // Hide the first-enable notice if watch is disabled or if it was already dismissed by timeout/interaction
  // The primary logic for showing first-enable notice is in the event listener for watchEnabledToggle
  const firstEnableNoticeDiv = document.getElementById('watchFeatureFirstEnableNotice');
  if (firstEnableNoticeDiv && watchEnabledToggle && !watchEnabledToggle.checked) {
    firstEnableNoticeDiv.style.display = 'none';
  }
}
