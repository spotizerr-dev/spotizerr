// queue.js
class DownloadQueue {
  constructor() {
    this.downloadQueue = {};
    this.prgInterval = null;
    this.initDOM();
    this.initEventListeners();
    this.loadExistingPrgFiles();
  }

  /* DOM Management */
  initDOM() {
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
  }

  /* Event Handling */
  initEventListeners() {
    // Escape key handler
    document.addEventListener('keydown', (e) => {
      const queueSidebar = document.getElementById('downloadQueue');
      if (e.key === 'Escape' && queueSidebar.classList.contains('active')) {
        this.toggleVisibility();
      }
    });

    // Close button handler
    document.getElementById('downloadQueue').addEventListener('click', (e) => {
      if (e.target.closest('.close-btn')) {
        this.toggleVisibility();
      }
    });
  }

  /* Public API */
  toggleVisibility() {
    const queueSidebar = document.getElementById('downloadQueue');
    queueSidebar.classList.toggle('active');
    queueSidebar.hidden = !queueSidebar.classList.contains('active');
    this.dispatchEvent('queueVisibilityChanged', { visible: queueSidebar.classList.contains('active') });
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

  /* Core Functionality */
  async startEntryMonitoring(queueId) {
    const entry = this.downloadQueue[queueId];
    if (!entry || entry.hasEnded) return;

    entry.intervalId = setInterval(async () => {
      // Note: use the current prgFile value stored in the entry to build the log element id.
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

        if (!progress) {
          this.handleInactivity(entry, queueId, logElement);
          return;
        }

        // If the new progress is the same as the last, also treat it as inactivity.
        if (JSON.stringify(entry.lastStatus) === JSON.stringify(progress)) {
          this.handleInactivity(entry, queueId, logElement);
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
      uniqueId: queueId
    };
  }

  createQueueItem(item, type, prgFile, queueId) {
    const div = document.createElement('article');
    div.className = 'queue-item';
    div.setAttribute('aria-live', 'polite');
    div.setAttribute('aria-atomic', 'true');
    div.innerHTML = `
      <div class="title">${item.name}</div>
      <div class="type">${type.charAt(0).toUpperCase() + type.slice(1)}</div>
      <div class="log" id="log-${queueId}-${prgFile}">Initializing download...</div>
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
      // For three or more items: join all but the last with commas, then " and " the last item.
      return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
    }

    // Helper function for a simple pluralization:
    function pluralize(word) {
      return word.endsWith('s') ? word : word + 's';
    }

    switch (data.status) {
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
        return `Track "${data.song}" by ${data.artist}" failed, retrying (${data.retry_count}/10) in ${data.seconds_left}s`;

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

  /* New Methods to Handle Terminal State and Inactivity */

  handleTerminalState(entry, queueId, progress) {
    // Mark the entry as ended and clear its monitoring interval.
    entry.hasEnded = true;
    clearInterval(entry.intervalId);
    const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
    if (!logElement) return;

    // If the terminal state is an error, hide the cancel button and add error buttons.
    if (progress.status === 'error') {
      // Hide the cancel button.
      const cancelBtn = entry.element.querySelector('.cancel-btn');
      if (cancelBtn) {
        cancelBtn.style.display = 'none';
      }

      logElement.innerHTML = `
        <div class="error-message">${this.getStatusMessage(progress)}</div>
        <div class="error-buttons">
          <button class="close-error-btn" title="Close">&times;</button>
          <button class="retry-btn" title="Retry">Retry</button>
        </div>
      `;
      
      // Close (X) button: immediately remove the queue entry.
      logElement.querySelector('.close-error-btn').addEventListener('click', () => {
        this.cleanupEntry(queueId);
      });
      
      // Retry button: re-send the original API request.
      logElement.querySelector('.retry-btn').addEventListener('click', async () => {
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
            logEl.textContent = 'Retry initiated...';
            
            // Restart monitoring using the new prg_file.
            this.startEntryMonitoring(queueId);
          } else {
            logElement.textContent = 'Retry failed: invalid response from server';
          }
        } catch (error) {
          logElement.textContent = 'Retry failed: ' + error.message;
        }
      });
      // Do not automatically clean up if an error occurred.
      return;
    } else {
      // For non-error terminal states, update the message and then clean up after 5 seconds.
      logElement.textContent = this.getStatusMessage(progress);
      setTimeout(() => this.cleanupEntry(queueId), 5000);
    }
  }

  handleInactivity(entry, queueId, logElement) {
    // If no update in 10 seconds, treat as an error.
    const now = Date.now();
    if (now - entry.lastUpdated > 300000) {
      const progress = { status: 'error', message: 'Inactivity timeout' };
      this.handleTerminalState(entry, queueId, progress);
    } else {
      if (logElement) {
        logElement.textContent = this.getStatusMessage(entry.lastStatus)
      }
    }
  }
}

// Singleton instance
export const downloadQueue = new DownloadQueue();
