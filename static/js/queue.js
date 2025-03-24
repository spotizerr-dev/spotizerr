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

    // Cache for queue items
    this.queueCache = {};
    
    // Queue entry objects
    this.queueEntries = {};
    
    // EventSource connections for SSE tracking
    this.sseConnections = {};
    
    // DOM elements cache
    this.elements = {};
    
    // Event handlers
    this.eventHandlers = {};
    
    // Configuration
    this.config = null;
    
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
      this.config.downloadQueueVisible = storedVisible === "true";
    }

    const queueSidebar = document.getElementById('downloadQueue');
    queueSidebar.hidden = !this.config.downloadQueueVisible;
    queueSidebar.classList.toggle('active', this.config.downloadQueueVisible);
    
    // Initialize the queue icon based on sidebar visibility
    const queueIcon = document.getElementById('queueIcon');
    if (queueIcon) {
      if (this.config.downloadQueueVisible) {
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
        for (const queueId in this.queueEntries) {
          const entry = this.queueEntries[queueId];
          if (!entry.hasEnded) {
            fetch(`/api/${entry.type}/download/cancel?prg_file=${entry.prgFile}`)
              .then(response => response.json())
              .then(data => {
                const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
                if (logElement) logElement.textContent = "Download cancelled";
                entry.hasEnded = true;
                
                // Close SSE connection
                this.clearPollingInterval(queueId);
                
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
    
    // Close all SSE connections when the page is about to unload
    window.addEventListener('beforeunload', () => {
      this.clearAllPollingIntervals();
    });
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
      const updatedConfig = { ...this.config, downloadQueueVisible: isVisible };
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
  addDownload(item, type, prgFile, requestUrl = null, startMonitoring = false) {
    const queueId = this.generateQueueId();
    const entry = this.createQueueEntry(item, type, prgFile, queueId, requestUrl);
    this.queueEntries[queueId] = entry;
    // Re-render and update which entries are processed.
    this.updateQueueOrder();
    
    // Only start monitoring if explicitly requested
    if (startMonitoring && this.isEntryVisible(queueId)) {
      this.startDownloadStatusMonitoring(queueId);
    }
    
    this.dispatchEvent('downloadAdded', { queueId, item, type });
    return queueId; // Return the queueId so callers can reference it
  }

  /* Start processing the entry only if it is visible. */
  async startDownloadStatusMonitoring(queueId) {
    const entry = this.queueEntries[queueId];
    if (!entry || entry.hasEnded) return;
    
    // Don't restart monitoring if SSE connection already exists
    if (this.sseConnections[queueId]) return;

    // Show a preparing message for new entries
    if (entry.isNew) {
      const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
      if (logElement) {
        logElement.textContent = "Initializing download...";
      }
    }
    
    // For backward compatibility, first try to get initial status from the REST API
    try {
      const response = await fetch(`/api/prgs/${entry.prgFile}`);
      if (response.ok) {
        const data = await response.json();
        
        // Update entry type if available
        if (data.type) {
          entry.type = data.type;
          
          // Update type display if element exists
          const typeElement = entry.element.querySelector('.type');
          if (typeElement) {
            typeElement.textContent = data.type.charAt(0).toUpperCase() + data.type.slice(1);
            typeElement.className = `type ${data.type}`;
          }
        }
        
        // Update request URL if available
        if (!entry.requestUrl && data.original_request) {
          const params = new CustomURLSearchParams();
          for (const key in data.original_request) {
            params.append(key, data.original_request[key]);
          }
          entry.requestUrl = `/api/${entry.type}/download?${params.toString()}`;
        }
        
        // Process the initial status
        if (data.last_line) {
          entry.lastStatus = data.last_line;
          entry.lastUpdated = Date.now();
          entry.status = data.last_line.status;
          
          // Update status message without recreating the element
          const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
          if (logElement) {
            const statusMessage = this.getStatusMessage(data.last_line);
            logElement.textContent = statusMessage;
          }
          
          // Apply appropriate CSS classes based on status
          this.applyStatusClasses(entry, data.last_line);
          
          // Save updated status to cache
          this.queueCache[entry.prgFile] = data.last_line;
          localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));
          
          // If the entry is already in a terminal state, don't set up SSE
          if (['error', 'complete', 'cancel', 'cancelled', 'done'].includes(data.last_line.status)) {
            entry.hasEnded = true;
            this.handleDownloadCompletion(entry, queueId, data.last_line);
            return;
          }
        }
      }
    } catch (error) {
      console.error('Initial status check failed:', error);
    }
    
    // Set up SSE connection for real-time updates
    this.setupPollingInterval(queueId);
  }

  /* Helper Methods */
  generateQueueId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Creates a new queue entry. It checks localStorage for any cached info.
   */
  createQueueEntry(item, type, prgFile, queueId, requestUrl) {
    console.log(`Creating queue entry with initial type: ${type}`);
    
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
      isNew: true, // Add flag to track if this is a new entry
      status: 'initializing',
      lastMessage: `Initializing ${type} download...`
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
    
    // Store it in our queue object
    this.queueEntries[queueId] = entry;
    
    return entry;
  }

  /**
   * Returns an HTML element for the queue entry.
   */
  createQueueItem(item, type, prgFile, queueId) {
    const defaultMessage = (type === 'playlist') ? 'Reading track list' : 'Initializing download...';
    
    // Use display values if available, or fall back to standard fields
    // Support both 'name' and 'music' fields which may be used by the backend
    const displayTitle = item.name || item.music || item.song || 'Unknown';
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
    // If no element, nothing to do
    if (!entry.element) return;
    
    // Remove all status classes first
    entry.element.classList.remove(
      'queued', 'initializing', 'downloading', 'processing', 
      'error', 'complete', 'cancelled', 'progress'
    );
    
    // Handle various status types
    switch (status) {
      case 'queued':
        entry.element.classList.add('queued');
        break;
      case 'initializing':
        entry.element.classList.add('initializing');
        break;
      case 'processing':
      case 'downloading':
        entry.element.classList.add('processing');
        break;
      case 'progress':
      case 'track_progress':
      case 'real_time':
        entry.element.classList.add('progress');
        break;
      case 'error':
        entry.element.classList.add('error');
        break;
      case 'complete':
      case 'done': 
        entry.element.classList.add('complete');
        break;
      case 'cancelled':
        entry.element.classList.add('cancelled');
        break;
    }
  }

  async handleCancelDownload(e) {
    const btn = e.target.closest('button');
    btn.style.display = 'none';
    const { prg, type, queueid } = btn.dataset;
    try {
      // First cancel the download
      const response = await fetch(`/api/${type}/download/cancel?prg_file=${prg}`);
      const data = await response.json();
      if (data.status === "cancel") {
        const logElement = document.getElementById(`log-${queueid}-${prg}`);
        logElement.textContent = "Download cancelled";
        const entry = this.queueEntries[queueid];
        if (entry) {
          entry.hasEnded = true;
          
          // Close any active connections
          this.clearPollingInterval(queueid);
          
          if (entry.intervalId) {
            clearInterval(entry.intervalId);
            entry.intervalId = null;
          }
          
          // Mark as cancelled in the cache to prevent re-loading on page refresh
          entry.status = "cancelled";
          this.queueCache[prg] = { status: "cancelled" };
          localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));
          
          // Immediately delete from server instead of just waiting for UI cleanup
          try {
            await fetch(`/api/prgs/delete/${prg}`, {
              method: 'DELETE'
            });
            console.log(`Deleted cancelled task from server: ${prg}`);
          } catch (deleteError) {
            console.error('Error deleting cancelled task:', deleteError);
          }
        }
        
        // Still do UI cleanup after a short delay
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
    const entries = Object.values(this.queueEntries);

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

    // Update the header with just the total count
    document.getElementById('queueTotalCount').textContent = entries.length;
    
    // Remove subtitle with detailed stats if it exists
    const subtitleEl = document.getElementById('queueSubtitle');
    if (subtitleEl) {
      subtitleEl.remove();
    }
    
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
          // We no longer automatically start monitoring here
          // Monitoring is now explicitly started by the methods that create downloads
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
          // We no longer automatically start monitoring here
          container.appendChild(entry.element);
          
          // Mark the entry as not new anymore
          entry.isNew = false;
        });
      }
    }
    
    // We no longer start or stop monitoring based on visibility changes here
    // This allows the explicit monitoring control from the download methods
    
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
    const entries = Object.values(this.queueEntries);
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

  async cleanupEntry(queueId) {
    const entry = this.queueEntries[queueId];
    if (entry) {
      // Close any SSE connection
      this.clearPollingInterval(queueId);
      
      // Clean up any intervals
      if (entry.intervalId) {
        clearInterval(entry.intervalId);
      }
      if (entry.autoRetryInterval) {
        clearInterval(entry.autoRetryInterval);
      }
      
      // Remove from the DOM
      entry.element.remove();
      
      // Delete from in-memory queue
      delete this.queueEntries[queueId];
      
      // Remove the cached info
      if (this.queueCache[entry.prgFile]) {
        delete this.queueCache[entry.prgFile];
        localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));
      }
      
      // Delete the entry from the server
      try {
        const response = await fetch(`/api/prgs/delete/${entry.prgFile}`, { method: 'DELETE' });
        if (response.ok) {
          console.log(`Successfully deleted task ${entry.prgFile} from server`);
        } else {
          console.warn(`Failed to delete task ${entry.prgFile}: ${response.status} ${response.statusText}`);
        }
      } catch (error) {
        console.error(`Error deleting task ${entry.prgFile}:`, error);
      }
      
      // Update the queue display
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
    
    // Extract the track name - check 'music' field first (from backend), then 'song', then 'name'
    const trackName = data.music || data.song || data.name || 'Unknown';
    
    switch (data.status) {
      case 'queued':
        if (data.type === 'album' || data.type === 'playlist') {
          return `Queued ${data.type} "${data.name}"${data.position ? ` (position ${data.position})` : ''}`;
        } else if (data.type === 'track') {
          return `Queued track "${trackName}"${data.artist ? ` by ${data.artist}` : ''}`;
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
          return `Downloading track "${trackName}"${data.artist ? ` by ${data.artist}` : ''}...`;
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
          return `Finished track "${trackName}"${data.artist ? ` by ${data.artist}` : ''}`;
        } else if (data.type === 'playlist') {
          return `Finished playlist "${data.name}" with ${data.total_tracks} tracks`;
        } else if (data.type === 'album') {
          return `Finished album "${data.album}" by ${data.artist}`;
        } else if (data.type === 'artist') {
          return `Finished artist "${data.artist}" (${data.album_type})`;
        }
        return `Finished ${data.type}`;
      
      case 'complete':
        if (data.type === 'track') {
          return `Finished track "${trackName}"${data.artist ? ` by ${data.artist}` : ''}`;
        } else if (data.type === 'playlist') {
          return `Finished playlist "${data.name}" with ${data.total_tracks || ''} tracks`;
        } else if (data.type === 'album') {
          return `Finished album "${data.album || data.name}" by ${data.artist}`;
        } else if (data.type === 'artist') {
          return `Finished artist "${data.artist}" (${data.album_type || ''})`;
        }
        return `Download completed successfully`;
      
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
      
      case 'skipped':
        return `Track "${trackName}" skipped, it already exists!`;
      
      case 'real_time': {
        const totalMs = data.time_elapsed;
        const minutes = Math.floor(totalMs / 60000);
        const seconds = Math.floor((totalMs % 60000) / 1000);
        const paddedSeconds = seconds < 10 ? '0' + seconds : seconds;
        return `Real-time downloading track "${trackName}"${data.artist ? ` by ${data.artist}` : ''} (${(data.percentage * 100).toFixed(1)}%). Time elapsed: ${minutes}:${paddedSeconds}`;
      }
      
      default:
        return data.status;
    }
  }

  /* New Methods to Handle Terminal State, Inactivity and Auto-Retry */
  handleDownloadCompletion(entry, queueId, progress) {
    // Mark the entry as ended
    entry.hasEnded = true;
    
    // Update progress bar if available
    if (typeof progress === 'number') {
      const progressBar = entry.element.querySelector('.progress-bar');
      if (progressBar) {
        progressBar.style.width = '100%';
        progressBar.setAttribute('aria-valuenow', 100);
        progressBar.classList.add('bg-success');
      }
    }
    
    // Stop polling
    this.clearPollingInterval(queueId);
    
    // Use 10 seconds cleanup delay for all states including errors
    const cleanupDelay = 10000;
    
    // Clean up after the appropriate delay
    setTimeout(() => {
      this.cleanupEntry(queueId);
    }, cleanupDelay);
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
      this.handleDownloadCompletion(entry, queueId, progress);
    } else {
      if (logElement) {
        logElement.textContent = this.getStatusMessage(entry.lastStatus);
      }
    }
  }

  async retryDownload(queueId, logElement) {
    const entry = this.queueEntries[queueId];
    if (!entry) return;
    
    logElement.textContent = 'Retrying download...';
    
    // Find a retry URL from various possible sources
    const getRetryUrl = () => {
      if (entry.requestUrl) return entry.requestUrl;
      
      // If we have lastStatus with original_request, check there
      if (entry.lastStatus && entry.lastStatus.original_request) {
        if (entry.lastStatus.original_request.retry_url) 
          return entry.lastStatus.original_request.retry_url;
        if (entry.lastStatus.original_request.url) 
          return entry.lastStatus.original_request.url;
      }
      
      // Check if there's a URL directly in the lastStatus
      if (entry.lastStatus && entry.lastStatus.url) 
        return entry.lastStatus.url;
      
      return null;
    };
    
    const retryUrl = getRetryUrl();
    
    // If we don't have any retry URL, show error
    if (!retryUrl) {
      logElement.textContent = 'Retry not available: missing URL information.';
      return;
    }
    
    try {
      // Close any existing SSE connection
      this.clearPollingInterval(queueId);
      
      console.log(`Retrying download for ${entry.type} with URL: ${retryUrl}`);
      
      // Build the API URL based on the entry's type
      const apiUrl = `/api/${entry.type}/download?url=${encodeURIComponent(retryUrl)}`;
      
      // Add name and artist if available for better progress display
      let fullRetryUrl = apiUrl;
      if (entry.item && entry.item.name) {
        fullRetryUrl += `&name=${encodeURIComponent(entry.item.name)}`;
      }
      if (entry.item && entry.item.artist) {
        fullRetryUrl += `&artist=${encodeURIComponent(entry.item.artist)}`;
      }
      
      // Use the stored original request URL to create a new download
      const retryResponse = await fetch(fullRetryUrl);
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
        entry.statusCheckFailures = 0; // Reset failure counter
        logEl.textContent = 'Retry initiated...';
        
        // Make sure any existing interval is cleared
        if (entry.intervalId) {
          clearInterval(entry.intervalId);
          entry.intervalId = null;
        }
        
        // Set up a new SSE connection for the retried download
        this.setupPollingInterval(queueId);
      } else {
        logElement.textContent = 'Retry failed: invalid response from server';
      }
    } catch (error) {
      console.error('Retry error:', error);
      logElement.textContent = 'Retry failed: ' + error.message;
    }
  }

  /**
   * Start monitoring for all active entries in the queue that are visible
   */
  startMonitoringActiveEntries() {
    for (const queueId in this.queueEntries) {
      const entry = this.queueEntries[queueId];
      // Only start monitoring if the entry is not in a terminal state and is visible
      if (!entry.hasEnded && this.isEntryVisible(queueId) && !this.sseConnections[queueId]) {
        this.setupPollingInterval(queueId);
      }
    }
  }

  /**
   * Centralized download method for all content types.
   * This method replaces the individual startTrackDownload, startAlbumDownload, etc. methods.
   * It will be called by all the other JS files.
   */
  async download(url, type, item, albumType = null) {
    if (!url) {
      throw new Error('Missing URL for download');
    }
    
    await this.loadConfig();
    
    // Build the API URL with only necessary parameters
    let apiUrl = `/api/${type}/download?url=${encodeURIComponent(url)}`;
    
    // Add name and artist if available for better progress display
    if (item.name) {
      apiUrl += `&name=${encodeURIComponent(item.name)}`;
    }
    if (item.artist) {
      apiUrl += `&artist=${encodeURIComponent(item.artist)}`;
    }
    
    // For artist downloads, include album_type
    if (type === 'artist' && albumType) {
      apiUrl += `&album_type=${encodeURIComponent(albumType)}`;
    }
    
    try {
      // Show a loading indicator
      if (document.getElementById('queueIcon')) {
        document.getElementById('queueIcon').classList.add('queue-icon-active');
      }
      
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      
      const data = await response.json();
      
      // Handle artist downloads which return multiple album tasks
      if (type === 'artist') {
        // Check for new API response format
        if (data.task_ids && Array.isArray(data.task_ids)) {
          // For artist discographies, we get individual task IDs for each album
          console.log(`Queued artist discography with ${data.task_ids.length} albums`);
          
          // Make queue visible to show progress
          this.toggleVisibility(true);
          
          // Show a temporary message about the artist download
          const artistMessage = document.createElement('div');
          artistMessage.className = 'queue-artist-message';
          artistMessage.textContent = `Queued ${data.task_ids.length} albums for ${item.name || 'artist'}. Loading...`;
          document.getElementById('queueItems').prepend(artistMessage);
          
          // Wait a moment to ensure backend has processed the tasks
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Remove the temporary message
          artistMessage.remove();
          
          // Fetch the latest tasks to show all newly created album downloads
          await this.loadExistingPrgFiles();
          
          // Start monitoring all new tasks immediately
          for (const queueId in this.queueEntries) {
            const entry = this.queueEntries[queueId];
            // Only start monitoring if the entry is not in a terminal state
            if (!entry.hasEnded && !this.sseConnections[queueId]) {
              this.setupPollingInterval(queueId);
            }
          }
          
          return data.task_ids;
        } 
        // Check for older API response format
        else if (data.album_prg_files && Array.isArray(data.album_prg_files)) {
          console.log(`Queued artist discography with ${data.album_prg_files.length} albums (old format)`);
          
          // Show a temporary message about the artist download
          const artistMessage = document.createElement('div');
          artistMessage.className = 'queue-artist-message';
          artistMessage.textContent = `Queued ${data.album_prg_files.length} albums for ${item.name || 'artist'}. Loading...`;
          document.getElementById('queueItems').prepend(artistMessage);
          
          // Add each album to the download queue separately
          const queueIds = [];
          data.album_prg_files.forEach(prgFile => {
            const queueId = this.addDownload(item, 'album', prgFile, apiUrl, false);
            queueIds.push({queueId, prgFile});
          });
          
          // Make queue visible to show progress
          this.toggleVisibility(true);
          
          // Wait a short time before setting up SSE connections
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Remove the temporary message
          artistMessage.remove();
          
          // Fetch the latest tasks to show all newly created album downloads
          await this.loadExistingPrgFiles();
          
          // Set up SSE connections for each entry
          for (const queueId in this.queueEntries) {
            const entry = this.queueEntries[queueId];
            if (entry && !entry.hasEnded) {
              this.setupPollingInterval(queueId);
            }
          }
          
          return queueIds.map(({queueId}) => queueId);
        }
        // Handle any other response format for artist downloads
        else {
          console.log(`Queued artist discography with unknown format:`, data);
          
          // Show a temporary message
          const artistMessage = document.createElement('div');
          artistMessage.className = 'queue-artist-message';
          artistMessage.textContent = `Queued albums for ${item.name || 'artist'}. Loading...`;
          document.getElementById('queueItems').prepend(artistMessage);
          
          // Make queue visible
          this.toggleVisibility(true);
          
          // Wait a moment for tasks to be created on the backend
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Remove the temporary message
          artistMessage.remove();
          
          // Fetch the latest tasks to show all newly created album downloads
          await this.loadExistingPrgFiles();
          
          // Start monitoring all entries
          for (const queueId in this.queueEntries) {
            const entry = this.queueEntries[queueId];
            if (entry && !entry.hasEnded) {
              this.setupPollingInterval(queueId);
            }
          }
          
          return data;
        }
      }
      
      // Handle single-file downloads (tracks, albums, playlists)
      if (data.prg_file) {
        const queueId = this.addDownload(item, type, data.prg_file, apiUrl, false);
        
        // Wait a short time before setting up SSE connection
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Set up SSE connection
        const entry = this.queueEntries[queueId];
        if (entry && !entry.hasEnded) {
          this.setupPollingInterval(queueId);
        }
        
        return queueId;
      } else {
        throw new Error('Invalid response format from server');
      }
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
      // Clear existing queue entries first to avoid duplicates when refreshing
      for (const queueId in this.queueEntries) {
        const entry = this.queueEntries[queueId];
        // Close any active connections
        this.clearPollingInterval(queueId);
        
        // Don't remove the entry from DOM - we'll rebuild it entirely
        delete this.queueEntries[queueId];
      }
      
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
          
          // Skip prg files that are marked as cancelled, completed, or interrupted
          if (prgData.last_line && 
              (prgData.last_line.status === 'cancel' || 
               prgData.last_line.status === 'cancelled' ||
               prgData.last_line.status === 'interrupted' ||
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
          
          // Check cached status - if we marked it cancelled locally, delete it and skip
          const cachedStatus = this.queueCache[prgFile];
          if (cachedStatus && 
              (cachedStatus.status === 'cancelled' || 
               cachedStatus.status === 'cancel' ||
               cachedStatus.status === 'interrupted' ||
               cachedStatus.status === 'complete')) {
            try {
              await fetch(`/api/prgs/delete/${prgFile}`, { method: 'DELETE' });
              console.log(`Cleaned up cached cancelled PRG file: ${prgFile}`);
            } catch (error) {
              console.error(`Failed to delete cached cancelled PRG file ${prgFile}:`, error);
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
            params.append('url', dummyItem.url);
            
            if (dummyItem.name) params.append('name', dummyItem.name);
            if (dummyItem.artist) params.append('artist', dummyItem.artist);
            
            // Add any other parameters from the original request
            for (const [key, value] of Object.entries(originalRequest)) {
              if (!['url', 'name', 'artist', 'type', 'endpoint', 'download_type', 
                   'display_title', 'display_type', 'display_artist', 'service'].includes(key)) {
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
          
          this.queueEntries[queueId] = entry;
        } catch (error) {
          console.error("Error fetching details for", prgFile, error);
        }
      }
      
      // Save updated cache to localStorage
      localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));
      
      // After adding all entries, update the queue
      this.updateQueueOrder();
      
      // Start monitoring for all active entries that are visible
      // This is the key change to ensure continued status updates after page refresh
      this.startMonitoringActiveEntries();
    } catch (error) {
      console.error("Error loading existing PRG files:", error);
    }
  }

  async loadConfig() {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('Failed to fetch config');
      this.config = await response.json();
      
      // Update our retry constants from the server config
      if (this.config.maxRetries !== undefined) {
        this.MAX_RETRIES = this.config.maxRetries;
      }
      if (this.config.retryDelaySeconds !== undefined) {
        this.RETRY_DELAY = this.config.retryDelaySeconds;
      }
      if (this.config.retry_delay_increase !== undefined) {
        this.RETRY_DELAY_INCREASE = this.config.retry_delay_increase;
      }
      
      console.log(`Loaded retry settings from config: max=${this.MAX_RETRIES}, delay=${this.RETRY_DELAY}, increase=${this.RETRY_DELAY_INCREASE}`);
    } catch (error) {
      console.error('Error loading config:', error);
      this.config = {};
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
      this.config = await response.json();
    } catch (error) {
      console.error('Error saving config:', error);
      throw error;
    }
  }

  // Add a method to check if explicit filter is enabled
  isExplicitFilterEnabled() {
    return !!this.config.explicitFilter;
  }

  /* Sets up a Server-Sent Events connection for real-time status updates */
  setupPollingInterval(queueId) {
    console.log(`Setting up polling for ${queueId}`);
    const entry = this.queueEntries[queueId];
    if (!entry || !entry.prgFile) {
      console.warn(`No entry or prgFile for ${queueId}`);
      return;
    }
    
    // Close any existing connection
    this.clearPollingInterval(queueId);
    
    try {
      // Immediately fetch initial data
      this.fetchDownloadStatus(queueId);
      
      // Create a polling interval of 1 second
      const intervalId = setInterval(() => {
        this.fetchDownloadStatus(queueId);
      }, 1000);
      
      // Store the interval ID for later cleanup
      this.sseConnections[queueId] = intervalId;
    } catch (error) {
      console.error(`Error creating polling for ${queueId}:`, error);
      const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
      if (logElement) {
        logElement.textContent = `Error with download: ${error.message}`;
        entry.element.classList.add('error');
      }
    }
  }
  
  async fetchDownloadStatus(queueId) {
    const entry = this.queueEntries[queueId];
    if (!entry || !entry.prgFile) {
      console.warn(`No entry or prgFile for ${queueId}`);
      return;
    }
    
    try {
      const response = await fetch(`/api/prgs/${entry.prgFile}`);
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Initialize the download type if needed
      if (data.type && !entry.type) {
        console.log(`Setting entry type to: ${data.type}`);
        entry.type = data.type;
        
        // Update type display if element exists
        const typeElement = entry.element.querySelector('.type');
        if (typeElement) {
          typeElement.textContent = data.type.charAt(0).toUpperCase() + data.type.slice(1);
          // Update type class without triggering animation
          typeElement.className = `type ${data.type}`;
        }
      }
      
      // Filter the last_line if it doesn't match the entry's type
      if (data.last_line && data.last_line.type && entry.type && data.last_line.type !== entry.type) {
        console.log(`Skipping status update with type '${data.last_line.type}' for entry with type '${entry.type}'`);
        return;
      }
      
      // Process the update
      this.handleStatusUpdate(queueId, data);
      
      // Handle terminal states
      if (data.last_line && ['complete', 'error', 'cancelled', 'done'].includes(data.last_line.status)) {
        console.log(`Terminal state detected: ${data.last_line.status} for ${queueId}`);
        entry.hasEnded = true;
        
        setTimeout(() => {
          this.clearPollingInterval(queueId);
          this.cleanupEntry(queueId);
        }, 5000);
      }
      
    } catch (error) {
      console.error(`Error fetching status for ${queueId}:`, error);
      
      // Show error in log
      const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
      if (logElement) {
        logElement.textContent = `Error updating status: ${error.message}`;
      }
    }
  }
  
  clearPollingInterval(queueId) {
    if (this.sseConnections[queueId]) {
      console.log(`Stopping polling for ${queueId}`);
      try {
        // Clear the interval instead of closing the SSE connection
        clearInterval(this.sseConnections[queueId]);
      } catch (error) {
        console.error(`Error stopping polling for ${queueId}:`, error);
      }
      delete this.sseConnections[queueId];
    }
  }

  /* Handle SSE update events */
  handleStatusUpdate(queueId, data) {
    const entry = this.queueEntries[queueId];
    if (!entry) {
      console.warn(`No entry for ${queueId}`);
      return;
    }
    
    // Get status from the appropriate location in the data structure
    // For the new polling API, data is structured differently than the SSE events
    let status, message, progress;
    
    // Extract the actual status data from the API response
    const statusData = data.last_line || {};
    
    // Skip updates where the type doesn't match the entry's type
    if (statusData.type && entry.type && statusData.type !== entry.type) {
      return;
    }
    
    status = statusData.status || data.event || 'unknown';
    
    // For new polling API structure
    if (data.progress_message) {
      message = data.progress_message;
    } else if (statusData.message) {
      message = statusData.message;
    } else {
      message = `Status: ${status}`;
    }

    // Extract trackName from different possible fields
    const trackName = statusData.music || statusData.song || statusData.name || 'Unknown';
    if (trackName && trackName !== 'Unknown') {
      // Update the title in the queue item if we have a track name
      const titleEl = entry.element.querySelector('.title');
      if (titleEl && trackName !== titleEl.textContent) {
        titleEl.textContent = trackName;
      }
    }
    
    // Track progress data
    if (data.progress_percent) {
      progress = data.progress_percent;
    } else if (statusData.overall_progress) {
      progress = statusData.overall_progress;
    } else if (statusData.progress) {
      progress = statusData.progress;
    }
    
    // Special handling for error status
    if (status === 'error') {
      entry.hasEnded = true;
      
      // Hide the cancel button
      const cancelBtn = entry.element.querySelector('.cancel-btn');
      if (cancelBtn) {
        cancelBtn.style.display = 'none';
      }
      
      // Find a valid URL to use for retry from multiple possible sources
      const getRetryUrl = () => {
        // Check direct properties first
        if (entry.requestUrl) return entry.requestUrl;
        if (data.retry_url) return data.retry_url;
        if (statusData.retry_url) return statusData.retry_url;
        
        // Check in original_request object
        if (data.original_request) {
          if (data.original_request.retry_url) return data.original_request.retry_url;
          if (data.original_request.url) return data.original_request.url;
        }
        
        // Last resort - check if there's a URL directly in the data
        if (data.url) return data.url;
        
        return null;
      };
      
      // Determine if we can retry by finding a valid URL
      const retryUrl = getRetryUrl();
      
      // Save the retry URL if found
      if (retryUrl) {
        entry.requestUrl = retryUrl;
      }
      
      console.log(`Error for ${entry.type} download. Retry URL: ${retryUrl}`);
      
      // Get or create the log element
      const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
      if (logElement) {
        // Always show retry if we have a URL, even if we've reached retry limit
        const canRetry = !!retryUrl;
        
        if (canRetry) {
          // Create error UI with retry button
          logElement.innerHTML = `
            <div class="error-message">${message || this.getStatusMessage(statusData)}</div>
            <div class="error-buttons">
              <button class="close-error-btn" title="Close">&times;</button>
              <button class="retry-btn" title="Retry download">Retry</button>
            </div>
          `;
          
          // Add event listeners
          logElement.querySelector('.close-error-btn').addEventListener('click', () => {
            if (entry.autoRetryInterval) {
              clearInterval(entry.autoRetryInterval);
              entry.autoRetryInterval = null;
            }
            this.cleanupEntry(queueId);
          });
          
          logElement.querySelector('.retry-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Replace retry button with loading indicator
            const retryBtn = logElement.querySelector('.retry-btn');
            if (retryBtn) {
              retryBtn.disabled = true;
              retryBtn.innerHTML = '<span class="loading-spinner small"></span> Retrying...';
            }
            
            if (entry.autoRetryInterval) {
              clearInterval(entry.autoRetryInterval);
              entry.autoRetryInterval = null;
            }
            
            this.retryDownload(queueId, logElement);
          });
          
          // Set up automatic cleanup after 10 seconds
          setTimeout(() => {
            if (this.queueEntries[queueId] && this.queueEntries[queueId].hasEnded) {
              this.cleanupEntry(queueId);
            }
          }, 10000);
        } else {
          // Cannot retry - just show error with close button
          logElement.innerHTML = `
            <div class="error-message">${message || this.getStatusMessage(statusData)}</div>
            <div class="error-buttons">
              <button class="close-error-btn" title="Close">&times;</button>
            </div>
          `;
          
          logElement.querySelector('.close-error-btn').addEventListener('click', () => {
            this.cleanupEntry(queueId);
          });
          
          // Set up automatic cleanup after 10 seconds
          setTimeout(() => {
            if (this.queueEntries[queueId] && this.queueEntries[queueId].hasEnded) {
              this.cleanupEntry(queueId);
            }
          }, 10000);
        }
      }
      
      // Update CSS classes for error state
      entry.element.classList.remove('queued', 'initializing', 'downloading', 'processing', 'progress');
      entry.element.classList.add('error');
      
      // Close SSE connection
      this.clearPollingInterval(queueId);
    } else {
      // For non-error states, update the log element with the latest message
      const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
      if (logElement && message) {
        logElement.textContent = message;
      } else if (logElement) {
        // Generate a message if none provided
        logElement.textContent = this.getStatusMessage(statusData);
      }
      
      // Set the proper status classes on the list item
      this.applyStatusClasses(entry, status);
      
      // Handle progress indicators
      const progressBar = entry.element.querySelector('.progress-bar');
      if (progressBar && typeof progress === 'number') {
        progressBar.style.width = `${progress}%`;
        progressBar.setAttribute('aria-valuenow', progress);
        
        if (progress >= 100) {
          progressBar.classList.add('bg-success');
        } else {
          progressBar.classList.remove('bg-success');
        }
      }
    }
    
    // Store the last status update
    entry.lastStatus = {
      ...statusData,
      message: message,
      status: status
    };
    entry.lastUpdated = Date.now();
    
    // Store in cache
    this.queueCache[entry.prgFile] = entry.lastStatus;
    localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));
    
    // Handle terminal states (except errors which we handle separately above)
    if (['complete', 'cancelled', 'done'].includes(status)) {
      this.handleDownloadCompletion(entry, queueId, progress);
    }
  }

  /* Close all active SSE connections */
  clearAllPollingIntervals() {
    for (const queueId in this.sseConnections) {
      this.clearPollingInterval(queueId);
    }
  }
}

// Singleton instance
export const downloadQueue = new DownloadQueue();
