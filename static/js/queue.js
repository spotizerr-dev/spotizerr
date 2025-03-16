// --- MODIFIED: Custom URLSearchParams class that does not encode anything ---
class CustomURLSearchParams {
  constructor() {
    this.params = {};
  }
  append(key, value) {
    this.params[key] = value;
  }
  toString() {
    return Object.entries(this.params)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
  }
}
// --- END MODIFIED ---

class DownloadQueue {
  constructor() {
    // Constants read from the server config
    this.MAX_RETRIES = 3;      // Default max retries
    this.RETRY_DELAY = 5;      // Default retry delay in seconds
    this.RETRY_DELAY_INCREASE = 5; // Default retry delay increase in seconds

    this.downloadQueue = {}; // keyed by unique queueId
    this.currentConfig = {}; // Cache for current config

    // Load the saved visible count (or default to 10)
    const storedVisibleCount = localStorage.getItem("downloadQueueVisibleCount");
    this.visibleCount = storedVisibleCount ? parseInt(storedVisibleCount, 10) : 10;
    
    // Load the cached status info (object keyed by prgFile)
    this.queueCache = JSON.parse(localStorage.getItem("downloadQueueCache") || "{}");
    
    // Wait for initDOM to complete before setting up event listeners and loading existing PRG files.
    this.initDOM().then(() => {
      this.initEventListeners();
      this.loadExistingPrgFiles();
    });
  }

  /* DOM Management */
  async initDOM() {
    // New HTML structure for the download queue.
    const queueHTML = `
      <div id="downloadQueue" class="sidebar right" hidden>
        <div class="sidebar-header">
          <h2>Download Queue (<span id="queueTotalCount">0</span> items)</h2>
          <div class="header-actions">
            <button id="cancelAllBtn" aria-label="Cancel all downloads">
              <img src="https://www.svgrepo.com/show/488384/skull-head.svg" alt="Skull" class="skull-icon">
              Cancel all
            </button>
          </div>
        </div>
        <div id="queueItems" aria-live="polite"></div>
        <div id="queueFooter"></div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', queueHTML);

    // Load initial config from the server.
    await this.loadConfig();

    // Override the server value with locally persisted queue visibility (if present).
    const storedVisible = localStorage.getItem("downloadQueueVisible");
    if (storedVisible !== null) {
      this.currentConfig.downloadQueueVisible = storedVisible === "true";
    }

    const queueSidebar = document.getElementById('downloadQueue');
    queueSidebar.hidden = !this.currentConfig.downloadQueueVisible;
    queueSidebar.classList.toggle('active', this.currentConfig.downloadQueueVisible);
    
    // Initialize the queue icon based on sidebar visibility
    const queueIcon = document.getElementById('queueIcon');
    if (queueIcon) {
      if (this.currentConfig.downloadQueueVisible) {
        queueIcon.innerHTML = '<span class="queue-x">&times;</span>';
        queueIcon.setAttribute('aria-expanded', 'true');
        queueIcon.classList.add('queue-icon-active'); // Add red tint class
      } else {
        queueIcon.innerHTML = '<img src="/static/images/queue.svg" alt="Queue Icon">';
        queueIcon.setAttribute('aria-expanded', 'false');
        queueIcon.classList.remove('queue-icon-active'); // Remove red tint class
      }
    }
  }

  /* Event Handling */
  initEventListeners() {
    // Toggle queue visibility via Escape key.
    document.addEventListener('keydown', async (e) => {
      const queueSidebar = document.getElementById('downloadQueue');
      if (e.key === 'Escape' && queueSidebar.classList.contains('active')) {
        await this.toggleVisibility();
      }
    });

    // "Cancel all" button.
    const cancelAllBtn = document.getElementById('cancelAllBtn');
    if (cancelAllBtn) {
      cancelAllBtn.addEventListener('click', () => {
        for (const queueId in this.downloadQueue) {
          const entry = this.downloadQueue[queueId];
          if (!entry.hasEnded) {
            fetch(`/api/${entry.type}/download/cancel?prg_file=${entry.prgFile}`)
              .then(response => response.json())
              .then(data => {
                const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
                if (logElement) logElement.textContent = "Download cancelled";
                entry.hasEnded = true;
                if (entry.intervalId) {
                  clearInterval(entry.intervalId);
                  entry.intervalId = null;
                }
                // Cleanup the entry after a short delay.
                setTimeout(() => this.cleanupEntry(queueId), 5000);
              })
              .catch(error => console.error('Cancel error:', error));
          }
        }
      });
    }
  }

  /* Public API */
  async toggleVisibility(force) {
    const queueSidebar = document.getElementById('downloadQueue');
    // If force is provided, use that value, otherwise toggle the current state
    const isVisible = force !== undefined ? force : !queueSidebar.classList.contains('active');
    
    queueSidebar.classList.toggle('active', isVisible);
    queueSidebar.hidden = !isVisible;

    // Update the queue icon to show X when visible or queue icon when hidden
    const queueIcon = document.getElementById('queueIcon');
    if (queueIcon) {
      if (isVisible) {
        // Replace the image with an X and add red tint
        queueIcon.innerHTML = '<span class="queue-x">&times;</span>';
        queueIcon.setAttribute('aria-expanded', 'true');
        queueIcon.classList.add('queue-icon-active'); // Add red tint class
      } else {
        // Restore the original queue icon and remove red tint
        queueIcon.innerHTML = '<img src="/static/images/queue.svg" alt="Queue Icon">';
        queueIcon.setAttribute('aria-expanded', 'false');
        queueIcon.classList.remove('queue-icon-active'); // Remove red tint class
      }
    }

    // Persist the state locally so it survives refreshes.
    localStorage.setItem("downloadQueueVisible", isVisible);

    try {
      await this.loadConfig();
      const updatedConfig = { ...this.currentConfig, downloadQueueVisible: isVisible };
      await this.saveConfig(updatedConfig);
      this.dispatchEvent('queueVisibilityChanged', { visible: isVisible });
    } catch (error) {
      console.error('Failed to save queue visibility:', error);
      // Revert UI if save failed.
      queueSidebar.classList.toggle('active', !isVisible);
      queueSidebar.hidden = isVisible;
      // Also revert the icon back
      if (queueIcon) {
        if (!isVisible) {
          queueIcon.innerHTML = '<span class="queue-x">&times;</span>';
          queueIcon.setAttribute('aria-expanded', 'true');
          queueIcon.classList.add('queue-icon-active'); // Add red tint class
        } else {
          queueIcon.innerHTML = '<img src="/static/images/queue.svg" alt="Queue Icon">';
          queueIcon.setAttribute('aria-expanded', 'false');
          queueIcon.classList.remove('queue-icon-active'); // Remove red tint class
        }
      }
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
   * Adds a new download entry.
   */
  addDownload(item, type, prgFile, requestUrl = null) {
    const queueId = this.generateQueueId();
    const entry = this.createQueueEntry(item, type, prgFile, queueId, requestUrl);
    this.downloadQueue[queueId] = entry;
    // Re-render and update which entries are processed.
    this.updateQueueOrder();
    this.dispatchEvent('downloadAdded', { queueId, item, type });
  }

  /* Start processing the entry only if it is visible. */
  async startEntryMonitoring(queueId) {
    const entry = this.downloadQueue[queueId];
    if (!entry || entry.hasEnded) return;
    if (entry.intervalId) return;

    entry.intervalId = setInterval(async () => {
      if (!this.isEntryVisible(queueId)) {
        clearInterval(entry.intervalId);
        entry.intervalId = null;
        return;
      }
      const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
      if (entry.hasEnded) {
        clearInterval(entry.intervalId);
        return;
      }
      try {
        const response = await fetch(`/api/prgs/${entry.prgFile}`);
        const data = await response.json();

        if (data.type) {
          entry.type = data.type;
          
          // Update type display if element exists
          const typeElement = entry.element.querySelector('.type');
          if (typeElement) {
            typeElement.textContent = data.type.charAt(0).toUpperCase() + data.type.slice(1);
            // Update type class without triggering animation
            typeElement.className = `type ${data.type}`;
          }
        }

        if (!entry.requestUrl && data.original_request) {
          const params = new CustomURLSearchParams();
          for (const key in data.original_request) {
            params.append(key, data.original_request[key]);
          }
          entry.requestUrl = `/api/${entry.type}/download?${params.toString()}`;
        }

        const progress = data.last_line;

        if (progress && typeof progress.status === 'undefined') {
          if (entry.type === 'playlist') {
            logElement.textContent = "Reading tracks list...";
          }
          this.updateQueueOrder();
          return;
        }
        if (!progress) {
          if (entry.type === 'playlist') {
            logElement.textContent = "Reading tracks list...";
          } else {
            this.handleInactivity(entry, queueId, logElement);
          }
          this.updateQueueOrder();
          return;
        }
        if (JSON.stringify(entry.lastStatus) === JSON.stringify(progress)) {
          this.handleInactivity(entry, queueId, logElement);
          this.updateQueueOrder();
          return;
        }

        // Update the entry and cache.
        entry.lastStatus = progress;
        entry.lastUpdated = Date.now();
        entry.status = progress.status;
        
        // Update status message without recreating the element
        if (logElement) {
          const statusMessage = this.getStatusMessage(progress);
          logElement.textContent = statusMessage;
        }
        
        // Apply appropriate CSS classes based on status
        this.applyStatusClasses(entry, progress);
        
        // Save updated status to cache.
        this.queueCache[entry.prgFile] = progress;
        localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));

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
      this.updateQueueOrder();
    }, 2000);
  }

  /* Helper Methods */
  generateQueueId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Creates a new queue entry. It checks localStorage for any cached info.
   */
  createQueueEntry(item, type, prgFile, queueId, requestUrl) {
    // Build the basic entry.
    const entry = {
      item,
      type,
      prgFile,
      requestUrl, // for potential retry
      element: this.createQueueItem(item, type, prgFile, queueId),
      lastStatus: null,
      lastUpdated: Date.now(),
      hasEnded: false,
      intervalId: null,
      uniqueId: queueId,
      retryCount: 0,
      autoRetryInterval: null,
      isNew: true // Add flag to track if this is a new entry
    };
    // If cached info exists for this PRG file, use it.
    if (this.queueCache[prgFile]) {
      entry.lastStatus = this.queueCache[prgFile];
      const logEl = entry.element.querySelector('.log');
      
      // Special handling for error states to restore UI with buttons
      if (entry.lastStatus.status === 'error') {
        // Hide the cancel button if in error state
        const cancelBtn = entry.element.querySelector('.cancel-btn');
        if (cancelBtn) {
          cancelBtn.style.display = 'none';
        }
        
        // Determine if we can retry
        const canRetry = entry.retryCount < this.MAX_RETRIES && entry.requestUrl;
        
        if (canRetry) {
          // Create error UI with retry button
          logEl.innerHTML = `
            <div class="error-message">${this.getStatusMessage(entry.lastStatus)}</div>
            <div class="error-buttons">
              <button class="close-error-btn" title="Close">&times;</button>
              <button class="retry-btn" title="Retry">Retry</button>
            </div>
          `;
          
          // Add event listeners
          logEl.querySelector('.close-error-btn').addEventListener('click', () => {
            if (entry.autoRetryInterval) {
              clearInterval(entry.autoRetryInterval);
              entry.autoRetryInterval = null;
            }
            this.cleanupEntry(queueId);
          });
          
          logEl.querySelector('.retry-btn').addEventListener('click', async () => {
            if (entry.autoRetryInterval) {
              clearInterval(entry.autoRetryInterval);
              entry.autoRetryInterval = null;
            }
            this.retryDownload(queueId, logEl);
          });
        } else {
          // Cannot retry - just show error with close button
          logEl.innerHTML = `
            <div class="error-message">${this.getStatusMessage(entry.lastStatus)}</div>
            <div class="error-buttons">
              <button class="close-error-btn" title="Close">&times;</button>
            </div>
          `;
          
          logEl.querySelector('.close-error-btn').addEventListener('click', () => {
            this.cleanupEntry(queueId);
          });
        }
      } else {
        // For non-error states, just set the message text
        logEl.textContent = this.getStatusMessage(entry.lastStatus);
      }
      
      // Apply appropriate CSS classes based on cached status
      this.applyStatusClasses(entry, this.queueCache[prgFile]);
    }
    return entry;
  }

  /**
   * Returns an HTML element for the queue entry.
   */
  createQueueItem(item, type, prgFile, queueId) {
    const defaultMessage = (type === 'playlist') ? 'Reading track list' : 'Initializing download...';
    
    // Use display values if available, or fall back to standard fields
    const displayTitle = item.name || 'Unknown';
    const displayType = type.charAt(0).toUpperCase() + type.slice(1);
    
    const div = document.createElement('article');
    div.className = 'queue-item queue-item-new'; // Add the animation class
    div.setAttribute('aria-live', 'polite');
    div.setAttribute('aria-atomic', 'true');
    div.innerHTML = `
      <div class="title">${displayTitle}</div>
      <div class="type ${type}">${displayType}</div>
      <div class="log" id="log-${queueId}-${prgFile}">${defaultMessage}</div>
      <button class="cancel-btn" data-prg="${prgFile}" data-type="${type}" data-queueid="${queueId}" title="Cancel Download">
        <img src="https://www.svgrepo.com/show/488384/skull-head.svg" alt="Cancel Download">
      </button>
    `;
    div.querySelector('.cancel-btn').addEventListener('click', (e) => this.handleCancelDownload(e));
    
    // Remove the animation class after animation completes
    setTimeout(() => {
      div.classList.remove('queue-item-new');
    }, 300); // Match the animation duration
    
    return div;
  }

  // Add a helper method to apply the right CSS classes based on status
  applyStatusClasses(entry, status) {
    if (!entry || !entry.element || !status) return;
    
    // Clear existing status classes
    entry.element.classList.remove('queue-item--processing', 'queue-item--error', 'download-success');
    
    // Apply appropriate class based on status
    if (status.status === 'processing' || status.status === 'downloading' || status.status === 'progress') {
      entry.element.classList.add('queue-item--processing');
    } else if (status.status === 'error') {
      entry.element.classList.add('queue-item--error');
      entry.hasEnded = true;
    } else if (status.status === 'complete' || status.status === 'done') {
      entry.element.classList.add('download-success');
      entry.hasEnded = true;
    } else if (status.status === 'cancel' || status.status === 'interrupted') {
      entry.hasEnded = true;
    }
    
    // Special case for retry status
    if (status.retrying || status.status === 'retrying') {
      entry.element.classList.add('queue-item--processing');
    }
  }

  async handleCancelDownload(e) {
    const btn = e.target.closest('button');
    btn.style.display = 'none';
    const { prg, type, queueid } = btn.dataset;
    try {
      const response = await fetch(`/api/${type}/download/cancel?prg_file=${prg}`);
      const data = await response.json();
      if (data.status === "cancel") {
        const logElement = document.getElementById(`log-${queueid}-${prg}`);
        logElement.textContent = "Download cancelled";
        const entry = this.downloadQueue[queueid];
        if (entry) {
          entry.hasEnded = true;
          clearInterval(entry.intervalId);
          entry.intervalId = null;
        }
        setTimeout(() => this.cleanupEntry(queueid), 5000);
      }
    } catch (error) {
      console.error('Cancel error:', error);
    }
  }

  /* Reorders the queue display, updates the total count, and handles "Show more" */
  updateQueueOrder() {
    const container = document.getElementById('queueItems');
    const footer = document.getElementById('queueFooter');
    const entries = Object.values(this.downloadQueue);

    // Sorting: errors/canceled first (group 0), ongoing next (group 1), queued last (group 2, sorted by position).
    entries.sort((a, b) => {
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
        if (groupA === 2) {
          const posA = a.lastStatus && a.lastStatus.position ? a.lastStatus.position : Infinity;
          const posB = b.lastStatus && b.lastStatus.position ? b.lastStatus.position : Infinity;
          return posA - posB;
        }
        return a.lastUpdated - b.lastUpdated;
      }
    });

    document.getElementById('queueTotalCount').textContent = entries.length;
    
    // Only recreate the container content if really needed
    const visibleEntries = entries.slice(0, this.visibleCount);
    
    // Handle empty state
    if (entries.length === 0) {
      container.innerHTML = `
        <div class="queue-empty">
          <img src="/static/images/queue-empty.svg" alt="Empty queue" onerror="this.src='/static/images/queue.svg'">
          <p>Your download queue is empty</p>
        </div>
      `;
    } else {
      // Get currently visible items
      const visibleItems = Array.from(container.children).filter(el => el.classList.contains('queue-item'));
      
      // Update container more efficiently
      if (visibleItems.length === 0) {
        // No items in container, append all visible entries
        container.innerHTML = ''; // Clear any empty state
        visibleEntries.forEach(entry => {
          // Start monitoring if needed
          if (!entry.intervalId) {
            this.startEntryMonitoring(entry.uniqueId);
          }
          container.appendChild(entry.element);
        });
      } else {
        // Container already has items, update more efficiently
        
        // Create a map of current DOM elements by queue ID
        const existingElementMap = {};
        visibleItems.forEach(el => {
          const queueId = el.querySelector('.cancel-btn')?.dataset.queueid;
          if (queueId) existingElementMap[queueId] = el;
        });
        
        // Clear container to re-add in correct order
        container.innerHTML = '';
        
        // Add visible entries in correct order
        visibleEntries.forEach(entry => {
          // Start monitoring if needed
          if (!entry.intervalId) {
            this.startEntryMonitoring(entry.uniqueId);
          }
          container.appendChild(entry.element);
          
          // Mark the entry as not new anymore
          entry.isNew = false;
        });
      }
    }
    
    // Stop monitoring entries that are no longer visible
    entries.slice(this.visibleCount).forEach(entry => {
      if (entry.intervalId) {
        clearInterval(entry.intervalId);
        entry.intervalId = null;
      }
    });

    // Update footer
    footer.innerHTML = '';
    if (entries.length > this.visibleCount) {
      const remaining = entries.length - this.visibleCount;
      const showMoreBtn = document.createElement('button');
      showMoreBtn.textContent = `Show ${remaining} more`;
      showMoreBtn.addEventListener('click', () => {
        this.visibleCount += 10;
        localStorage.setItem("downloadQueueVisibleCount", this.visibleCount);
        this.updateQueueOrder();
      });
      footer.appendChild(showMoreBtn);
    }
  }

  /* Checks if an entry is visible in the queue display. */
  isEntryVisible(queueId) {
    const entries = Object.values(this.downloadQueue);
    entries.sort((a, b) => {
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
        if (groupA === 2) {
          const posA = a.lastStatus && a.lastStatus.position ? a.lastStatus.position : Infinity;
          const posB = b.lastStatus && b.lastStatus.position ? b.lastStatus.position : Infinity;
          return posA - posB;
        }
        return a.lastUpdated - b.lastUpdated;
      }
    });
    const index = entries.findIndex(e => e.uniqueId === queueId);
    return index >= 0 && index < this.visibleCount;
  }

  cleanupEntry(queueId) {
    const entry = this.downloadQueue[queueId];
    if (entry) {
      if (entry.intervalId) {
        clearInterval(entry.intervalId);
      }
      if (entry.autoRetryInterval) {
        clearInterval(entry.autoRetryInterval);
      }
      entry.element.remove();
      delete this.downloadQueue[queueId];
      // Remove the cached info.
      if (this.queueCache[entry.prgFile]) {
        delete this.queueCache[entry.prgFile];
        localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));
      }
      fetch(`/api/prgs/delete/${entry.prgFile}`, { method: 'DELETE' })
        .catch(console.error);
      this.updateQueueOrder();
    }
  }

  /* Event Dispatching */
  dispatchEvent(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /* Status Message Handling */
  getStatusMessage(data) {
    function formatList(items) {
      if (!items || items.length === 0) return '';
      if (items.length === 1) return items[0];
      if (items.length === 2) return `${items[0]} and ${items[1]}`;
      return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
    }
    function pluralize(word) {
      return word.endsWith('s') ? word : word + 's';
    }
    switch (data.status) {
      case 'queued':
        if (data.type === 'album' || data.type === 'playlist') {
          return `Queued ${data.type} "${data.name}"${data.position ? ` (position ${data.position})` : ''}`;
        } else if (data.type === 'track') {
          return `Queued track "${data.name}"${data.artist ? ` by ${data.artist}` : ''}`;
        }
        return `Queued ${data.type} "${data.name}"`;
      
      case 'started':
        return `Download started`;
      
      case 'processing':
        return `Processing download...`;
        
      case 'cancel':
        return 'Download cancelled';
        
      case 'interrupted':
        return 'Download was interrupted';
      
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
        if (data.retry_count !== undefined) {
          return `Retrying download (attempt ${data.retry_count}/${this.MAX_RETRIES})`;
        }
        return `Retrying download...`;
      
      case 'error':
        let errorMsg = `Error: ${data.message || 'Unknown error'}`;
        if (data.can_retry !== undefined) {
          if (data.can_retry) {
            errorMsg += ` (Can be retried)`;
          } else {
            errorMsg += ` (Max retries reached)`;
          }
        }
        return errorMsg;
      
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
    entry.hasEnded = true;
    clearInterval(entry.intervalId);
    const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
    if (!logElement) return;
    
    // Save the terminal state to the cache for persistence across reloads
    this.queueCache[entry.prgFile] = progress;
    localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));
    
    // Add status classes without triggering animations
    this.applyStatusClasses(entry, progress);
    
    if (progress.status === 'error') {
      const cancelBtn = entry.element.querySelector('.cancel-btn');
      if (cancelBtn) {
        cancelBtn.style.display = 'none';
      }
      
      // Check if we're under the max retries threshold for auto-retry
      const canRetry = entry.retryCount < this.MAX_RETRIES;
      
      if (canRetry) {
        logElement.innerHTML = `
          <div class="error-message">${this.getStatusMessage(progress)}</div>
          <div class="error-buttons">
            <button class="close-error-btn" title="Close">&times;</button>
            <button class="retry-btn" title="Retry">Retry</button>
          </div>
        `;
        logElement.querySelector('.close-error-btn').addEventListener('click', () => {
          if (entry.autoRetryInterval) {
            clearInterval(entry.autoRetryInterval);
            entry.autoRetryInterval = null;
          }
          this.cleanupEntry(queueId);
        });
        logElement.querySelector('.retry-btn').addEventListener('click', async () => {
          if (entry.autoRetryInterval) {
            clearInterval(entry.autoRetryInterval);
            entry.autoRetryInterval = null;
          }
          this.retryDownload(queueId, logElement);
        });
        
        // Implement auto-retry if we have the original request URL
        if (entry.requestUrl) {
          const maxRetries = this.MAX_RETRIES;
          if (entry.retryCount < maxRetries) {
            // Calculate the delay based on retry count (exponential backoff)
            const baseDelay = this.RETRY_DELAY || 5; // seconds, use server's retry delay or default to 5
            const increase = this.RETRY_DELAY_INCREASE || 5;
            const retryDelay = baseDelay + (entry.retryCount * increase);
            
            let secondsLeft = retryDelay;
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
      } else {
        // Cannot be retried - just show the error
        logElement.innerHTML = `
          <div class="error-message">${this.getStatusMessage(progress)}</div>
          <div class="error-buttons">
            <button class="close-error-btn" title="Close">&times;</button>
          </div>
        `;
        logElement.querySelector('.close-error-btn').addEventListener('click', () => {
          this.cleanupEntry(queueId);
        });
      }
      return;
    } else if (progress.status === 'interrupted') {
      logElement.textContent = 'Download was interrupted';
      setTimeout(() => this.cleanupEntry(queueId), 5000);
    } else if (progress.status === 'complete') {
      logElement.textContent = 'Download completed successfully';
      // Hide the cancel button
      const cancelBtn = entry.element.querySelector('.cancel-btn');
      if (cancelBtn) {
        cancelBtn.style.display = 'none';
      }
      setTimeout(() => this.cleanupEntry(queueId), 5000);
    } else {
      logElement.textContent = this.getStatusMessage(progress);
      setTimeout(() => this.cleanupEntry(queueId), 5000);
    }
  }

  handleInactivity(entry, queueId, logElement) {
    if (entry.lastStatus && entry.lastStatus.status === 'queued') {
      if (logElement) {
        logElement.textContent = this.getStatusMessage(entry.lastStatus);
      }
      return;
    }
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

  async retryDownload(queueId, logElement) {
    const entry = this.downloadQueue[queueId];
    if (!entry) return;
    
    logElement.textContent = 'Retrying download...';
    
    // If we don't have the request URL, we can't retry
    if (!entry.requestUrl) {
      logElement.textContent = 'Retry not available: missing original request information.';
      return;
    }
    
    try {
      // Use the stored original request URL to create a new download
      const retryResponse = await fetch(entry.requestUrl);
      if (!retryResponse.ok) {
        throw new Error(`Server returned ${retryResponse.status}`);
      }
      
      const retryData = await retryResponse.json();
      
      if (retryData.prg_file) {
        // If the old PRG file exists, we should delete it
        const oldPrgFile = entry.prgFile;
        if (oldPrgFile) {
          try {
            await fetch(`/api/prgs/delete/${oldPrgFile}`, { method: 'DELETE' });
          } catch (deleteError) {
            console.error('Error deleting old PRG file:', deleteError);
          }
        }
        
        // Update the entry with the new PRG file
        const logEl = entry.element.querySelector('.log');
        logEl.id = `log-${entry.uniqueId}-${retryData.prg_file}`;
        entry.prgFile = retryData.prg_file;
        entry.lastStatus = null;
        entry.hasEnded = false;
        entry.lastUpdated = Date.now();
        entry.retryCount = (entry.retryCount || 0) + 1;
        logEl.textContent = 'Retry initiated...';
        
        // Start monitoring the new PRG file
        this.startEntryMonitoring(queueId);
      } else {
        logElement.textContent = 'Retry failed: invalid response from server';
      }
    } catch (error) {
      console.error('Retry error:', error);
      logElement.textContent = 'Retry failed: ' + error.message;
    }
  }

  async startTrackDownload(url, item) {
    await this.loadConfig();
    const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
    
    // Use minimal parameters in the URL, letting server use config for defaults
    const apiUrl = `/api/track/download?service=${service}&url=${encodeURIComponent(url)}` + 
                  (item.name ? `&name=${encodeURIComponent(item.name)}` : '') +
                  (item.artist ? `&artist=${encodeURIComponent(item.artist)}` : '');
    
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
    
    // Use minimal parameters in the URL, letting server use config for defaults
    const apiUrl = `/api/playlist/download?service=${service}&url=${encodeURIComponent(url)}` + 
                  (item.name ? `&name=${encodeURIComponent(item.name)}` : '') +
                  (item.artist ? `&artist=${encodeURIComponent(item.artist)}` : '');
    
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error('Network error');
      const data = await response.json();
      this.addDownload(item, 'playlist', data.prg_file, apiUrl);
    } catch (error) {
      this.dispatchEvent('downloadError', { error, item });
      throw error;
    }
  }

  async startArtistDownload(url, item, albumType = 'album,single,compilation') {
    await this.loadConfig();
    const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
    
    // Use minimal parameters in the URL, letting server use config for defaults
    const apiUrl = `/api/artist/download?service=${service}&url=${encodeURIComponent(url)}` +
                  `&album_type=${albumType}` +
                  (item.name ? `&name=${encodeURIComponent(item.name)}` : '') +
                  (item.artist ? `&artist=${encodeURIComponent(item.artist)}` : '');
    
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error('Network error');
      const data = await response.json();
      if (data.album_prg_files && Array.isArray(data.album_prg_files)) {
        data.album_prg_files.forEach(prgFile => {
          this.addDownload(item, 'album', prgFile, apiUrl);
        });
      } else if (data.prg_file) {
        this.addDownload(item, 'album', data.prg_file, apiUrl);
      }
    } catch (error) {
      this.dispatchEvent('downloadError', { error, item });
      throw error;
    }
  }
  
  async startAlbumDownload(url, item) {
    await this.loadConfig();
    const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
    
    // Use minimal parameters in the URL, letting server use config for defaults
    const apiUrl = `/api/album/download?service=${service}&url=${encodeURIComponent(url)}` +
                  (item.name ? `&name=${encodeURIComponent(item.name)}` : '') +
                  (item.artist ? `&artist=${encodeURIComponent(item.artist)}` : '');
    
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error('Network error');
      const data = await response.json();
      this.addDownload(item, 'album', data.prg_file, apiUrl);
    } catch (error) {
      this.dispatchEvent('downloadError', { error, item });
      throw error;
    }
  }

  /**
   * Loads existing PRG files from the /api/prgs/list endpoint and adds them as queue entries.
   */
  async loadExistingPrgFiles() {
    try {
      const response = await fetch('/api/prgs/list');
      const prgFiles = await response.json();
      
      // Sort filenames by the numeric portion (assumes format "type_number.prg").
      prgFiles.sort((a, b) => {
        const numA = parseInt(a.split('_')[1]);
        const numB = parseInt(b.split('_')[1]);
        return numA - numB;
      });

      // Iterate through each PRG file and add it as a dummy queue entry.
      for (const prgFile of prgFiles) {
        try {
          const prgResponse = await fetch(`/api/prgs/${prgFile}`);
          if (!prgResponse.ok) continue;
          const prgData = await prgResponse.json();
          
          // Skip prg files that are marked as cancelled or completed
          if (prgData.last_line && 
              (prgData.last_line.status === 'cancel' || 
               prgData.last_line.status === 'complete')) {
            // Delete old completed or cancelled PRG files
            try {
              await fetch(`/api/prgs/delete/${prgFile}`, { method: 'DELETE' });
              console.log(`Cleaned up old PRG file: ${prgFile}`);
            } catch (error) {
              console.error(`Failed to delete completed/cancelled PRG file ${prgFile}:`, error);
            }
            continue;
          }
          
          // Use the enhanced original request info from the first line
          const originalRequest = prgData.original_request || {};
          
          // Use the explicit display fields if available, or fall back to other fields
          const dummyItem = {
            name: prgData.display_title || originalRequest.display_title || originalRequest.name || prgFile,
            artist: prgData.display_artist || originalRequest.display_artist || originalRequest.artist || '',
            type: prgData.display_type || originalRequest.display_type || originalRequest.type || 'unknown',
            service: originalRequest.service || '',
            url: originalRequest.url || '',
            endpoint: originalRequest.endpoint || '',
            download_type: originalRequest.download_type || ''
          };
          
          // Check if this is a retry file and get the retry count
          let retryCount = 0;
          if (prgFile.includes('_retry')) {
            const retryMatch = prgFile.match(/_retry(\d+)/);
            if (retryMatch && retryMatch[1]) {
              retryCount = parseInt(retryMatch[1], 10);
            } else if (prgData.last_line && prgData.last_line.retry_count) {
              retryCount = prgData.last_line.retry_count;
            }
          } else if (prgData.last_line && prgData.last_line.retry_count) {
            retryCount = prgData.last_line.retry_count;
          }
          
          // Build a potential requestUrl from the original information
          let requestUrl = null;
          if (dummyItem.endpoint && dummyItem.url) {
            const params = new CustomURLSearchParams();
            params.append('service', dummyItem.service);
            params.append('url', dummyItem.url);
            
            if (dummyItem.name) params.append('name', dummyItem.name);
            if (dummyItem.artist) params.append('artist', dummyItem.artist);
            
            // Add any other parameters from the original request
            for (const [key, value] of Object.entries(originalRequest)) {
              if (!['service', 'url', 'name', 'artist', 'type', 'endpoint', 'download_type', 
                   'display_title', 'display_type', 'display_artist'].includes(key)) {
                params.append(key, value);
              }
            }
            
            requestUrl = `${dummyItem.endpoint}?${params.toString()}`;
          }
          
          // Add to download queue
          const queueId = this.generateQueueId();
          const entry = this.createQueueEntry(dummyItem, dummyItem.type, prgFile, queueId, requestUrl);
          entry.retryCount = retryCount;
          
          // Set the entry's last status from the PRG file
          if (prgData.last_line) {
            entry.lastStatus = prgData.last_line;
            
            // Make sure to save the status to the cache for persistence
            this.queueCache[prgFile] = prgData.last_line;
            
            // Apply proper status classes
            this.applyStatusClasses(entry, prgData.last_line);
          }
          
          this.downloadQueue[queueId] = entry;
        } catch (error) {
          console.error("Error fetching details for", prgFile, error);
        }
      }
      
      // Save updated cache to localStorage
      localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));
      
      // After adding all entries, update the queue
      this.updateQueueOrder();
    } catch (error) {
      console.error("Error loading existing PRG files:", error);
    }
  }

  async loadConfig() {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('Failed to fetch config');
      this.currentConfig = await response.json();
      
      // Update our retry constants from the server config
      if (this.currentConfig.maxRetries !== undefined) {
        this.MAX_RETRIES = this.currentConfig.maxRetries;
      }
      if (this.currentConfig.retryDelaySeconds !== undefined) {
        this.RETRY_DELAY = this.currentConfig.retryDelaySeconds;
      }
      if (this.currentConfig.retry_delay_increase !== undefined) {
        this.RETRY_DELAY_INCREASE = this.currentConfig.retry_delay_increase;
      }
      
      console.log(`Loaded retry settings from config: max=${this.MAX_RETRIES}, delay=${this.RETRY_DELAY}, increase=${this.RETRY_DELAY_INCREASE}`);
    } catch (error) {
      console.error('Error loading config:', error);
      this.currentConfig = {};
    }
  }

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
}

// Singleton instance
export const downloadQueue = new DownloadQueue();
