// queue.js

// --- NEW: Custom URLSearchParams class that does not encode specified keys ---
class CustomURLSearchParams {
  constructor(noEncodeKeys = []) {
    this.params = {};
    this.noEncodeKeys = noEncodeKeys;
  }
  append(key, value) {
    this.params[key] = value;
  }
  toString() {
    return Object.entries(this.params)
      .map(([key, value]) => {
        if (this.noEncodeKeys.includes(key)) {
          // Do not encode keys specified in noEncodeKeys.
          return `${key}=${value}`;
        } else {
          return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        }
      })
      .join('&');
  }
}

// --- END NEW ---

class DownloadQueue {
  constructor() {
    this.downloadQueue = {};
    this.prgInterval = null;
    this.currentConfig = {}; // Cache for current config

    // Wait for initDOM to complete before setting up event listeners and loading existing PRG files.
    this.initDOM().then(() => {
      this.initEventListeners();
      this.loadExistingPrgFiles();
    });
  }

  /* DOM Management */
  async initDOM() {
    const queueHTML = `
      <div id="downloadQueue" class="sidebar right" hidden>
        <div class="sidebar-header">
          <h2>Download Queue</h2>
          <button class="close-btn" aria-label="Close queue">&times;</button>
        </div>
        <div id="queueItems" aria-live="polite"></div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', queueHTML);

    // Load initial visibility from server config
    await this.loadConfig();
    const queueSidebar = document.getElementById('downloadQueue');
    queueSidebar.hidden = !this.currentConfig.downloadQueueVisible;
    queueSidebar.classList.toggle('active', this.currentConfig.downloadQueueVisible);
  }

  /* Event Handling */
  initEventListeners() {
    document.addEventListener('keydown', async (e) => {
      const queueSidebar = document.getElementById('downloadQueue');
      if (e.key === 'Escape' && queueSidebar.classList.contains('active')) {
        await this.toggleVisibility();
      }
    });

    const queueSidebar = document.getElementById('downloadQueue');
    if (queueSidebar) {
      queueSidebar.addEventListener('click', async (e) => {
        if (e.target.closest('.close-btn')) {
          await this.toggleVisibility();
        }
      });
    }
  }

  /* Public API */
  async toggleVisibility() {
    const queueSidebar = document.getElementById('downloadQueue');
    const isVisible = !queueSidebar.classList.contains('active');
    
    queueSidebar.classList.toggle('active', isVisible);
    queueSidebar.hidden = !isVisible;

    try {
      // Update config on server
      await this.loadConfig();
      const updatedConfig = { ...this.currentConfig, downloadQueueVisible: isVisible };
      await this.saveConfig(updatedConfig);
      this.dispatchEvent('queueVisibilityChanged', { visible: isVisible });
    } catch (error) {
      console.error('Failed to save queue visibility:', error);
      // Revert UI if save failed
      queueSidebar.classList.toggle('active', !isVisible);
      queueSidebar.hidden = isVisible;
      this.dispatchEvent('queueVisibilityChanged', { visible: !isVisible });
      this.showError('Failed to save queue visibility');
    }
  }

  showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'queue-error';
    errorDiv.textContent = message;
    document.getElementById('queueItems').prepend(errorDiv);
    setTimeout(() => errorDiv.remove(), 3000);
  }

  /**
   * Now accepts an extra argument "requestUrl" which is the same API call used to initiate the download.
   */
  addDownload(item, type, prgFile, requestUrl = null) {
    const queueId = this.generateQueueId();
    const entry = this.createQueueEntry(item, type, prgFile, queueId, requestUrl);

    this.downloadQueue[queueId] = entry;
    document.getElementById('queueItems').appendChild(entry.element);
    this.startEntryMonitoring(queueId);
    this.dispatchEvent('downloadAdded', { queueId, item, type });
  }

  async startEntryMonitoring(queueId) {
    const entry = this.downloadQueue[queueId];
    if (!entry || entry.hasEnded) return;

    entry.intervalId = setInterval(async () => {
      // Use the current prgFile value stored in the entry to build the log element id.
      const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
      if (entry.hasEnded) {
        clearInterval(entry.intervalId);
        return;
      }

      try {
        const response = await fetch(`/api/prgs/${entry.prgFile}`);
        const data = await response.json();

        // Update the entry type from the API response if available.
        if (data.type) {
          entry.type = data.type;
        }

        // If the prg file info contains the original_request parameters and we haven't stored a retry URL yet,
        // build one using the updated type and original_request parameters.
        if (!entry.requestUrl && data.original_request) {
          const params = new URLSearchParams(data.original_request).toString();
          entry.requestUrl = `/api/${entry.type}/download?${params}`;
        }

        const progress = data.last_line;

        // NEW: If the progress data exists but has no "status" parameter, ignore it.
        if (progress && typeof progress.status === 'undefined') {
          if (entry.type === 'playlist') {
            logElement.textContent = "Reading tracks list...";
          }
          this.updateQueueOrder();
          return;
        }
        // If there's no progress at all, treat as inactivity.
        if (!progress) {
          if (entry.type === 'playlist') {
            logElement.textContent = "Reading tracks list...";
          } else {
            this.handleInactivity(entry, queueId, logElement);
          }
          this.updateQueueOrder();
          return;
        }

        // If the new progress is the same as the last, also treat it as inactivity.
        if (JSON.stringify(entry.lastStatus) === JSON.stringify(progress)) {
          this.handleInactivity(entry, queueId, logElement);
          this.updateQueueOrder();
          return;
        }

        entry.lastStatus = progress;
        entry.lastUpdated = Date.now();
        entry.status = progress.status;
        logElement.textContent = this.getStatusMessage(progress);

        if (['error', 'complete', 'cancel'].includes(progress.status)) {
          this.handleTerminalState(entry, queueId, progress);
        }
      } catch (error) {
        console.error('Status check failed:', error);
        this.handleTerminalState(entry, queueId, { 
          status: 'error', 
          message: 'Status check error' 
        });
      }
      // Reorder the queue display after updating the entry status.
      this.updateQueueOrder();
    }, 2000);
  }


  /* Helper Methods */
  generateQueueId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Now accepts a fifth parameter "requestUrl" and stores it in the entry.
   */
  createQueueEntry(item, type, prgFile, queueId, requestUrl) {
    return {
      item,
      type,
      prgFile,
      requestUrl, // store the original API request URL so we can retry later
      element: this.createQueueItem(item, type, prgFile, queueId),
      lastStatus: null,
      lastUpdated: Date.now(),
      hasEnded: false,
      intervalId: null,
      uniqueId: queueId,
      retryCount: 0,         // Initialize retry counter
      autoRetryInterval: null // To store the countdown interval ID for auto retry
    };
  }

  createQueueItem(item, type, prgFile, queueId) {
    // Use "Reading track list" as the default message for playlists.
    const defaultMessage = (type === 'playlist') ? 'Reading track list' : 'Initializing download...';
    const div = document.createElement('article');
    div.className = 'queue-item';
    div.setAttribute('aria-live', 'polite');
    div.setAttribute('aria-atomic', 'true');
    div.innerHTML = `
      <div class="title">${item.name}</div>
      <div class="type">${type.charAt(0).toUpperCase() + type.slice(1)}</div>
      <div class="log" id="log-${queueId}-${prgFile}">${defaultMessage}</div>
      <button class="cancel-btn" data-prg="${prgFile}" data-type="${type}" data-queueid="${queueId}" title="Cancel Download">
        <img src="https://www.svgrepo.com/show/488384/skull-head.svg" alt="Cancel Download">
      </button>
    `;

    div.querySelector('.cancel-btn').addEventListener('click', (e) => this.handleCancelDownload(e));
    return div;
  }

  async handleCancelDownload(e) {
    const btn = e.target.closest('button');
    btn.style.display = 'none';

    const { prg, type, queueid } = btn.dataset;
    try {
      const response = await fetch(`/api/${type}/download/cancel?prg_file=${encodeURIComponent(prg)}`);
      const data = await response.json();

      if (data.status === "cancel") {
        const logElement = document.getElementById(`log-${queueid}-${prg}`);
        logElement.textContent = "Download cancelled";
        const entry = this.downloadQueue[queueid];
        if (entry) {
          entry.hasEnded = true;
          clearInterval(entry.intervalId);
        }
        setTimeout(() => this.cleanupEntry(queueid), 5000);
      }
    } catch (error) {
      console.error('Cancel error:', error);
    }
  }

  /* State Management */
  async loadExistingPrgFiles() {
    try {
      const response = await fetch('/api/prgs/list');
      const prgFiles = await response.json();

      for (const prgFile of prgFiles) {
        const prgResponse = await fetch(`/api/prgs/${prgFile}`);
        const prgData = await prgResponse.json();
        const dummyItem = { name: prgData.name || prgFile, external_urls: {} };
        // In this case, no original request URL is available.
        this.addDownload(dummyItem, prgData.type || "unknown", prgFile);
      }
    } catch (error) {
      console.error('Error loading existing PRG files:', error);
    }
  }

  cleanupEntry(queueId) {
    const entry = this.downloadQueue[queueId];
    if (entry) {
      clearInterval(entry.intervalId);
      if (entry.autoRetryInterval) {
        clearInterval(entry.autoRetryInterval);
      }
      entry.element.remove();
      delete this.downloadQueue[queueId];
      fetch(`/api/prgs/delete/${encodeURIComponent(entry.prgFile)}`, { method: 'DELETE' })
        .catch(console.error);
    }
  }

  /* Event Dispatching */
  dispatchEvent(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /* Status Message Handling */
  getStatusMessage(data) {
    // Helper function to format an array into a human-readable list without a comma before "and".
    function formatList(items) {
      if (!items || items.length === 0) return '';
      if (items.length === 1) return items[0];
      if (items.length === 2) return `${items[0]} and ${items[1]}`;
      return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
    }

    // Helper function for a simple pluralization:
    function pluralize(word) {
      return word.endsWith('s') ? word : word + 's';
    }

    switch (data.status) {
      case 'queued':
        // Display a friendly message for queued items.
        if (data.type === 'album' || data.type === 'playlist') {
          // Show the name and queue position if provided.
          return `Queued ${data.type} "${data.name}"${data.position ? ` (position ${data.position})` : ''}`;
        } else if (data.type === 'track') {
          return `Queued track "${data.name}"${data.artist ? ` by ${data.artist}` : ''}`;
        }
        return `Queued ${data.type} "${data.name}"`;

      case 'cancel':
        return 'Download cancelled';

      case 'downloading':
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
          let subsets = [];
          if (data.subsets && Array.isArray(data.subsets) && data.subsets.length > 0) {
            subsets = data.subsets;
          } else if (data.album_type) {
            subsets = data.album_type
              .split(',')
              .map(item => item.trim())
              .map(item => pluralize(item));
          }
          if (subsets.length > 0) {
            const subsetsMessage = formatList(subsets);
            return `Initializing download for ${data.artist}'s ${subsetsMessage}`;
          }
          return `Initializing download for ${data.artist} with ${data.total_albums} album(s) [${data.album_type}]...`;
        }
        return `Initializing ${data.type} download...`;

      case 'progress':
        if (data.track && data.current_track) {
          const parts = data.current_track.split('/');
          const current = parts[0];
          const total = parts[1] || '?';

          if (data.type === 'playlist') {
            return `Downloading playlist: Track ${current} of ${total} - ${data.track}`;
          } else if (data.type === 'album') {
            if (data.album && data.artist) {
              return `Downloading album "${data.album}" by ${data.artist}: track ${current} of ${total} - ${data.track}`;
            } else {
              return `Downloading track ${current} of ${total}: ${data.track} from ${data.album}`;
            }
          }
        }
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
        return `Track "${data.song}" by ${data.artist}" failed, retrying (${data.retry_count}/5) in ${data.seconds_left}s`;

      case 'error':
        return `Error: ${data.message || 'Unknown error'}`;

      case 'complete':
        return 'Download completed successfully';

      case 'skipped':
        return `Track "${data.song}" skipped, it already exists!`;

      case 'real_time': {
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


  /* New Methods to Handle Terminal State, Inactivity and Auto-Retry */

  handleTerminalState(entry, queueId, progress) {
    // Mark the entry as ended and clear its monitoring interval.
    entry.hasEnded = true;
    clearInterval(entry.intervalId);
    const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
    if (!logElement) return;

    if (progress.status === 'error') {
      // Hide the cancel button.
      const cancelBtn = entry.element.querySelector('.cancel-btn');
      if (cancelBtn) {
        cancelBtn.style.display = 'none';
      }

      // Display error message with retry buttons.
      logElement.innerHTML = `
        <div class="error-message">${this.getStatusMessage(progress)}</div>
        <div class="error-buttons">
          <button class="close-error-btn" title="Close">&times;</button>
          <button class="retry-btn" title="Retry">Retry</button>
        </div>
      `;

      // Close (X) button: immediately remove the queue entry.
      logElement.querySelector('.close-error-btn').addEventListener('click', () => {
        // If an auto-retry countdown is running, clear it.
        if (entry.autoRetryInterval) {
          clearInterval(entry.autoRetryInterval);
          entry.autoRetryInterval = null;
        }
        this.cleanupEntry(queueId);
      });

      // Manual Retry button: cancel the auto-retry timer (if running) and retry immediately.
      logElement.querySelector('.retry-btn').addEventListener('click', async () => {
        if (entry.autoRetryInterval) {
          clearInterval(entry.autoRetryInterval);
          entry.autoRetryInterval = null;
        }
        this.retryDownload(queueId, logElement);
      });

      // --- Auto-Retry Logic ---
      // Only auto-retry if we have a requestUrl.
      if (entry.requestUrl) {
        const maxRetries = 10;
        if (entry.retryCount < maxRetries) {
          const autoRetryDelay = 300; // seconds (5 minutes)
          let secondsLeft = autoRetryDelay;

          // Start a countdown that updates the error message every second.
          entry.autoRetryInterval = setInterval(() => {
            secondsLeft--;
            const errorMsgEl = logElement.querySelector('.error-message');
            if (errorMsgEl) {
              errorMsgEl.textContent = `Error: ${progress.message || 'Unknown error'}. Retrying in ${secondsLeft} seconds... (attempt ${entry.retryCount + 1}/${maxRetries})`;
            }
            if (secondsLeft <= 0) {
              clearInterval(entry.autoRetryInterval);
              entry.autoRetryInterval = null;
              this.retryDownload(queueId, logElement);
            }
          }, 1000);
        }
      }
      // Do not automatically clean up if an error occurred.
      return;
    } else {
      // For non-error terminal states, update the message and then clean up after 5 seconds.
      logElement.textContent = this.getStatusMessage(progress);
      setTimeout(() => this.cleanupEntry(queueId), 5000);
    }
  }

  handleInactivity(entry, queueId, logElement) {
    // If no update in 5 minutes (300,000ms), treat as an error.
    const now = Date.now();
    if (now - entry.lastUpdated > 300000) {
      const progress = { status: 'error', message: 'Inactivity timeout' };
      this.handleTerminalState(entry, queueId, progress);
    } else {
      if (logElement) {
        logElement.textContent = this.getStatusMessage(entry.lastStatus);
      }
    }
  }

  /**
   * retryDownload() handles both manual and automatic retries.
   */
  async retryDownload(queueId, logElement) {
    const entry = this.downloadQueue[queueId];
    if (!entry) return;

    logElement.textContent = 'Retrying download...';
    if (!entry.requestUrl) {
      logElement.textContent = 'Retry not available: missing original request information.';
      return;
    }
    try {
      const retryResponse = await fetch(entry.requestUrl);
      const retryData = await retryResponse.json();
      if (retryData.prg_file) {
        // Delete the failed prg file before updating to the new one.
        const oldPrgFile = entry.prgFile;
        await fetch(`/api/prgs/delete/${encodeURIComponent(oldPrgFile)}`, { method: 'DELETE' });

        // Update the log element's id to reflect the new prg_file.
        const logEl = entry.element.querySelector('.log');
        logEl.id = `log-${entry.uniqueId}-${retryData.prg_file}`;

        // Update the entry with the new prg_file and reset its state.
        entry.prgFile = retryData.prg_file;
        entry.lastStatus = null;
        entry.hasEnded = false;
        entry.lastUpdated = Date.now();
        entry.retryCount = (entry.retryCount || 0) + 1;
        logEl.textContent = 'Retry initiated...';

        // Restart monitoring using the new prg_file.
        this.startEntryMonitoring(queueId);
      } else {
        logElement.textContent = 'Retry failed: invalid response from server';
      }
    } catch (error) {
      logElement.textContent = 'Retry failed: ' + error.message;
    }
  }

  /**
   * Builds common URL parameters for download API requests.
   * 
   * Correction: When fallback is enabled for Spotify downloads, the active accounts
   * are now used correctly as follows:
   * 
   * - When fallback is true:
   *    • main = config.deezer  
   *    • fallback = config.spotify  
   *    • quality = config.deezerQuality  
   *    • fall_quality = config.spotifyQuality
   * 
   * - When fallback is false:
   *    • main = config.spotify  
   *    • quality = config.spotifyQuality
   * 
   * For Deezer downloads, always use:
   *    • main = config.deezer  
   *    • quality = config.deezerQuality
   */
  _buildCommonParams(url, service, config) {
    // --- MODIFIED: Use our custom parameter builder for Spotify ---
    let params;
    if (service === 'spotify') {
      params = new CustomURLSearchParams(['url']); // Do not encode the "url" parameter.
    } else {
      params = new URLSearchParams();
    }
    // --- END MODIFIED ---

    params.append('service', service);
    params.append('url', url);
  
    if (service === 'spotify') {
      if (config.fallback) {
        // Fallback enabled: use the active Deezer account as main and Spotify as fallback.
        params.append('main', config.deezer);
        params.append('fallback', config.spotify);
        params.append('quality', config.deezerQuality);
        params.append('fall_quality', config.spotifyQuality);
      } else {
        // Fallback disabled: use only the Spotify active account.
        params.append('main', config.spotify);
        params.append('quality', config.spotifyQuality);
      }
    } else {
      // For Deezer, always use the active Deezer account.
      params.append('main', config.deezer);
      params.append('quality', config.deezerQuality);
    }
  
    if (config.realTime) {
      params.append('real_time', 'true');
    }
  
    if (config.customTrackFormat) {
      params.append('custom_track_format', config.customTrackFormat);
    }
  
    if (config.customDirFormat) {
      params.append('custom_dir_format', config.customDirFormat);
    }
  
    return params;
  }

  async startTrackDownload(url, item) {
    await this.loadConfig();
    const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
    const params = this._buildCommonParams(url, service, this.currentConfig);
    // Add the extra parameters "name" and "artist"
    params.append('name', item.name || '');
    params.append('artist', item.artist || '');
    const apiUrl = `/api/track/download?${params.toString()}`;

    try {
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error('Network error');
      const data = await response.json();
      this.addDownload(item, 'track', data.prg_file, apiUrl);
    } catch (error) {
      this.dispatchEvent('downloadError', { error, item });
      throw error;
    }
  }

  async startPlaylistDownload(url, item) {
    await this.loadConfig();
    const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
    const params = this._buildCommonParams(url, service, this.currentConfig);
    // Add the extra parameters "name" and "artist"
    params.append('name', item.name || '');
    params.append('artist', item.artist || '');
    const apiUrl = `/api/playlist/download?${params.toString()}`;

    try {
      const response = await fetch(apiUrl);
      const data = await response.json();
      this.addDownload(item, 'playlist', data.prg_file, apiUrl);
    } catch (error) {
      this.dispatchEvent('downloadError', { error, item });
      throw error;
    }
  }

  async startAlbumDownload(url, item) {
    await this.loadConfig();
    const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
    const params = this._buildCommonParams(url, service, this.currentConfig);
    // Add the extra parameters "name" and "artist"
    params.append('name', item.name || '');
    params.append('artist', item.artist || '');
    const apiUrl = `/api/album/download?${params.toString()}`;

    try {
      const response = await fetch(apiUrl);
      const data = await response.json();
      this.addDownload(item, 'album', data.prg_file, apiUrl);
    } catch (error) {
      this.dispatchEvent('downloadError', { error, item });
      throw error;
    }
  }
  
  async startArtistDownload(url, item, albumType = 'album,single,compilation') {
    await this.loadConfig();
    const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
    const params = this._buildCommonParams(url, service, this.currentConfig);
    params.append('album_type', albumType);
    // Add the extra parameters "name" and "artist"
    params.append('name', item.name || '');
    params.append('artist', item.artist || '');
    const apiUrl = `/api/artist/download?${params.toString()}`;

    try {
      const response = await fetch(apiUrl);
      const data = await response.json();
      this.addDownload(item, 'artist', data.prg_file, apiUrl);
    } catch (error) {
      this.dispatchEvent('downloadError', { error, item });
      throw error;
    }
  }

  async loadConfig() {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('Failed to fetch config');
      this.currentConfig = await response.json();
    } catch (error) {
      console.error('Error loading config:', error);
      this.currentConfig = {};
    }
  }

  // Placeholder for saveConfig; implement as needed.
  async saveConfig(updatedConfig) {
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig)
      });
      if (!response.ok) throw new Error('Failed to save config');
      this.currentConfig = await response.json();
    } catch (error) {
      console.error('Error saving config:', error);
      throw error;
    }
  }
    /**
   * Reorders the download queue display so that:
   *   - Errored (or canceled) downloads come first (Group 0)
   *   - Ongoing downloads come next (Group 1)
   *   - Queued downloads come last (Group 2), ordered by their position value.
   */
    updateQueueOrder() {
      const container = document.getElementById('queueItems');
      const entries = Object.values(this.downloadQueue);
  
      entries.sort((a, b) => {
        // Define groups:
        // Group 0: Errored or canceled downloads
        // Group 2: Queued downloads
        // Group 1: All others (ongoing)
        const getGroup = (entry) => {
          if (entry.lastStatus && (entry.lastStatus.status === "error" || entry.lastStatus.status === "cancel")) {
            return 0;
          } else if (entry.lastStatus && entry.lastStatus.status === "queued") {
            return 2;
          } else {
            return 1;
          }
        };
  
        const groupA = getGroup(a);
        const groupB = getGroup(b);
        if (groupA !== groupB) {
          return groupA - groupB;
        } else {
          // For queued downloads, order by their "position" value (smallest first)
          if (groupA === 2) {
            const posA = a.lastStatus && a.lastStatus.position ? a.lastStatus.position : Infinity;
            const posB = b.lastStatus && b.lastStatus.position ? b.lastStatus.position : Infinity;
            return posA - posB;
          }
          // For errored or ongoing downloads, order by last update time (oldest first)
          return a.lastUpdated - b.lastUpdated;
        }
      });
  
      // Clear the container and re-append entries in sorted order.
      container.innerHTML = '';
      for (const entry of entries) {
        container.appendChild(entry.element);
      }
    }  
}

// Singleton instance
export const downloadQueue = new DownloadQueue();
