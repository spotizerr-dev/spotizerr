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
    
    // Polling intervals for progress tracking
    this.pollingIntervals = {};
    
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
          const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
          if (entry && !entry.hasEnded && entry.prgFile) {
            // Mark as cancelling visually
            if (entry.element) {
              entry.element.classList.add('cancelling');
            }
            if (logElement) {
              logElement.textContent = "Cancelling...";
            }
            
            // Cancel each active download
            fetch(`/api/${entry.type}/download/cancel?prg_file=${entry.prgFile}`)
              .then(response => response.json())
              .then(data => {
                if (data.status === "cancel") {
                  entry.hasEnded = true;
                  if (entry.intervalId) {
                    clearInterval(entry.intervalId);
                    entry.intervalId = null;
                  }
                  // Clean up immediately
                  this.cleanupEntry(queueId);
                }
              })
              .catch(error => console.error('Cancel error:', error));
          }
        }
        this.clearAllPollingIntervals();
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
    
    // Start monitoring if explicitly requested, regardless of visibility
    if (startMonitoring) {
      this.startDownloadStatusMonitoring(queueId);
    }
    
    this.dispatchEvent('downloadAdded', { queueId, item, type });
    return queueId; // Return the queueId so callers can reference it
  }

  /* Start processing the entry. Removed visibility check to ensure all entries are monitored. */
  async startDownloadStatusMonitoring(queueId) {
    const entry = this.queueEntries[queueId];
    if (!entry || entry.hasEnded) return;
    
    // Don't restart monitoring if polling interval already exists
    if (this.pollingIntervals[queueId]) return;
    
    // Ensure entry has data containers for parent info
    entry.parentInfo = entry.parentInfo || {};

    // Show a preparing message for new entries
    if (entry.isNew) {
      const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
      if (logElement) {
        logElement.textContent = "Initializing download...";
      }
    }
    
    console.log(`Starting monitoring for ${entry.type} with PRG file: ${entry.prgFile}`);
    
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
          
          // Save updated status to cache, ensuring we preserve parent data
          this.queueCache[entry.prgFile] = {
            ...data.last_line,
            // Ensure parent data is preserved
            parent: data.last_line.parent || entry.lastStatus?.parent
          };
          
          // If this is a track with a parent, update the display elements to match the parent
          if (data.last_line.type === 'track' && data.last_line.parent) {
            const parent = data.last_line.parent;
            entry.parentInfo = parent;
            
            // Update type and UI to reflect the parent type
            if (parent.type === 'album' || parent.type === 'playlist') {
              // Only change type if it's not already set to the parent type
              if (entry.type !== parent.type) {
                entry.type = parent.type;
                
                // Update the type indicator
                const typeEl = entry.element.querySelector('.type');
                if (typeEl) {
                  const displayType = parent.type.charAt(0).toUpperCase() + parent.type.slice(1);
                  typeEl.textContent = displayType;
                  typeEl.className = `type ${parent.type}`;
                }
                
                // Update the title and subtitle based on parent type
                const titleEl = entry.element.querySelector('.title');
                const artistEl = entry.element.querySelector('.artist');
                
                if (parent.type === 'album') {
                  if (titleEl) titleEl.textContent = parent.title || 'Unknown album';
                  if (artistEl) artistEl.textContent = parent.artist || 'Unknown artist';
                } else if (parent.type === 'playlist') {
                  if (titleEl) titleEl.textContent = parent.name || 'Unknown playlist';
                  if (artistEl) artistEl.textContent = parent.owner || 'Unknown creator';
                }
              }
            }
          }
          
          localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));
          
          // If the entry is already in a terminal state, don't set up polling
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
    
    // Set up polling interval for real-time updates
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
    
    // Get cached data if it exists
    const cachedData = this.queueCache[prgFile];
    
    // If we have cached data, use it to determine the true type and item properties
    if (cachedData) {
      // If this is a track with a parent, update type and item to match the parent
      if (cachedData.type === 'track' && cachedData.parent) {
        if (cachedData.parent.type === 'album') {
          type = 'album';
          item = {
            name: cachedData.parent.title,
            artist: cachedData.parent.artist,
            total_tracks: cachedData.parent.total_tracks,
            url: cachedData.parent.url
          };
        } else if (cachedData.parent.type === 'playlist') {
          type = 'playlist';
          item = {
            name: cachedData.parent.name,
            owner: cachedData.parent.owner,
            total_tracks: cachedData.parent.total_tracks,
            url: cachedData.parent.url
          };
        }
      }
      // If we're reconstructing an album or playlist directly
      else if (cachedData.type === 'album') {
        item = {
          name: cachedData.title || cachedData.album || 'Unknown album',
          artist: cachedData.artist || 'Unknown artist',
          total_tracks: cachedData.total_tracks || 0
        };
      } else if (cachedData.type === 'playlist') {
        item = {
          name: cachedData.name || 'Unknown playlist',
          owner: cachedData.owner || 'Unknown creator',
          total_tracks: cachedData.total_tracks || 0
        };
      }
    }
    
    // Build the basic entry with possibly updated type and item
    const entry = {
      item,
      type, 
      prgFile,
      requestUrl, // for potential retry
      element: this.createQueueItem(item, type, prgFile, queueId),
      lastStatus: {
        // Initialize with basic item metadata for immediate display
        type,
        status: 'initializing',
        name: item.name || 'Unknown',
        artist: item.artist || item.artists?.[0]?.name || '',
        album: item.album?.name || '',
        title: item.name || '',
        owner: item.owner || item.owner?.display_name || '',
        total_tracks: item.total_tracks || 0
      },
      lastUpdated: Date.now(),
      hasEnded: false,
      intervalId: null,
      uniqueId: queueId,
      retryCount: 0,
      autoRetryInterval: null,
      isNew: true, // Add flag to track if this is a new entry
      status: 'initializing',
      lastMessage: `Initializing ${type} download...`,
      parentInfo: null // Will store parent data for tracks that are part of albums/playlists
    };
    
    // If cached info exists for this PRG file, use it.
    if (cachedData) {
      entry.lastStatus = cachedData;
      const logEl = entry.element.querySelector('.log');
      
      // Store parent information if available
      if (cachedData.parent) {
        entry.parentInfo = cachedData.parent;
      }
      
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
 * Returns an HTML element for the queue entry with modern UI styling.
 */
createQueueItem(item, type, prgFile, queueId) {
  // Track whether this is a multi-track item (album or playlist)
  const isMultiTrack = type === 'album' || type === 'playlist';
  const defaultMessage = (type === 'playlist') ? 'Reading track list' : 'Initializing download...';
  
  // Use display values if available, or fall back to standard fields
  const displayTitle = item.name || item.music || item.song || 'Unknown';
  const displayArtist = item.artist || '';
  const displayType = type.charAt(0).toUpperCase() + type.slice(1);
  
  const div = document.createElement('article');
  div.className = 'queue-item queue-item-new'; // Add the animation class
  div.setAttribute('aria-live', 'polite');
  div.setAttribute('aria-atomic', 'true');
  div.setAttribute('data-type', type);
  
  // Create modern HTML structure with better visual hierarchy
  let innerHtml = `
    <div class="queue-item-header">
      <div class="queue-item-info">
        <div class="title">${displayTitle}</div>
        ${displayArtist ? `<div class="artist">${displayArtist}</div>` : ''}
        <div class="type ${type}">${displayType}</div>
      </div>
      <button class="cancel-btn" data-prg="${prgFile}" data-type="${type}" data-queueid="${queueId}" title="Cancel Download">
        <img src="https://www.svgrepo.com/show/488384/skull-head.svg" alt="Cancel Download">
      </button>
    </div>
    
    <div class="queue-item-status">
      <div class="log" id="log-${queueId}-${prgFile}">${defaultMessage}</div>
      
      <!-- Error details container (hidden by default) -->
      <div class="error-details" id="error-details-${queueId}-${prgFile}" style="display: none;"></div>
      
      <div class="progress-container">
        <!-- Track-level progress bar for single track or current track in multi-track items -->
        <div class="track-progress-bar-container" id="track-progress-container-${queueId}-${prgFile}">
          <div class="track-progress-bar" id="track-progress-bar-${queueId}-${prgFile}" 
               role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%;"></div>
        </div>
        
        <!-- Time elapsed for real-time downloads -->
        <div class="time-elapsed" id="time-elapsed-${queueId}-${prgFile}"></div>
      </div>
    </div>`;
  
  // For albums and playlists, add an overall progress container
  if (isMultiTrack) {
    innerHtml += `
    <div class="overall-progress-container">
      <div class="overall-progress-header">
        <span class="overall-progress-label">Overall Progress</span>
        <span class="overall-progress-count" id="progress-count-${queueId}-${prgFile}">0/0</span>
      </div>
      <div class="overall-progress-bar-container">
        <div class="overall-progress-bar" id="overall-bar-${queueId}-${prgFile}" 
             role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%;"></div>
      </div>
    </div>`;
  }
  
  div.innerHTML = innerHtml;
  
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
        // Show detailed error information in the error-details container if available
        if (entry.lastStatus && entry.element) {
          const errorDetailsContainer = entry.element.querySelector(`#error-details-${entry.uniqueId}-${entry.prgFile}`);
          if (errorDetailsContainer) {
            // Format the error details
            let errorDetailsHTML = '';
            
            // Add error message
            errorDetailsHTML += `<div class="error-message">${entry.lastStatus.error || entry.lastStatus.message || 'Unknown error'}</div>`;
            
            // Add parent information if available
            if (entry.lastStatus.parent) {
              const parent = entry.lastStatus.parent;
              let parentInfo = '';
              
              if (parent.type === 'album') {
                parentInfo = `<div class="parent-info">From album: "${parent.title}" by ${parent.artist || 'Unknown artist'}</div>`;
              } else if (parent.type === 'playlist') {
                parentInfo = `<div class="parent-info">From playlist: "${parent.name}" by ${parent.owner || 'Unknown creator'}</div>`;
              }
              
              if (parentInfo) {
                errorDetailsHTML += parentInfo;
              }
            }
            
            // Add source URL if available
            if (entry.lastStatus.url) {
              errorDetailsHTML += `<div class="error-url">Source: <a href="${entry.lastStatus.url}" target="_blank" rel="noopener noreferrer">${entry.lastStatus.url}</a></div>`;
            }
            
            // Add retry button if this error can be retried
            if (entry.lastStatus.can_retry !== false && (!entry.retryCount || entry.retryCount < this.MAX_RETRIES)) {
              errorDetailsHTML += `<button class="retry-btn" data-queueid="${entry.uniqueId}">Retry Download</button>`;
            }
            
            // Display the error details
            errorDetailsContainer.innerHTML = errorDetailsHTML;
            errorDetailsContainer.style.display = 'block';
            
            // Add event listener to retry button if present
            const retryBtn = errorDetailsContainer.querySelector('.retry-btn');
            if (retryBtn) {
              retryBtn.addEventListener('click', (e) => {
                const queueId = e.target.getAttribute('data-queueid');
                if (queueId) {
                  const logElement = entry.element.querySelector('.log');
                  this.retryDownload(queueId, logElement);
                }
              });
            }
          }
        }
        break;
      case 'complete':
      case 'done': 
        entry.element.classList.add('complete');
        // Hide error details if present
        if (entry.element) {
          const errorDetailsContainer = entry.element.querySelector(`#error-details-${entry.uniqueId}-${entry.prgFile}`);
          if (errorDetailsContainer) {
            errorDetailsContainer.style.display = 'none';
          }
        }
        break;
      case 'cancelled':
        entry.element.classList.add('cancelled');
        // Hide error details if present
        if (entry.element) {
          const errorDetailsContainer = entry.element.querySelector(`#error-details-${entry.uniqueId}-${entry.prgFile}`);
          if (errorDetailsContainer) {
            errorDetailsContainer.style.display = 'none';
          }
        }
        break;
    }
  }

  async handleCancelDownload(e) {
    const btn = e.target.closest('button');
    btn.style.display = 'none';
    const { prg, type, queueid } = btn.dataset;
    try {
      // Get the queue item element
      const entry = this.queueEntries[queueid];
      if (entry && entry.element) {
        // Add a visual indication that it's being cancelled
        entry.element.classList.add('cancelling');
      }
      
      // Show cancellation in progress
      const logElement = document.getElementById(`log-${queueid}-${prg}`);
      if (logElement) {
        logElement.textContent = "Cancelling...";
      }
      
      // First cancel the download
      const response = await fetch(`/api/${type}/download/cancel?prg_file=${prg}`);
      const data = await response.json();
      if (data.status === "cancel") {
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
          
          // Immediately delete from server
          try {
            await fetch(`/api/prgs/delete/${prg}`, {
              method: 'DELETE'
            });
            console.log(`Deleted cancelled task from server: ${prg}`);
          } catch (deleteError) {
            console.error('Error deleting cancelled task:', deleteError);
          }
          
          // Immediately remove the item from the UI
          this.cleanupEntry(queueid);
        }
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
      // Close any polling interval
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
    // Determine the true display type - if this is a track with a parent, we may want to
    // show it as part of the parent's download process
    let displayType = data.type || 'unknown';
    let isChildTrack = false;
    
    // If this is a track that's part of an album/playlist, note that
    if (data.type === 'track' && data.parent) {
      isChildTrack = true;
      // We'll still use track-specific info but note it's part of a parent
    }
    
    // Find the queue item this status belongs to
    let queueItem = null;
    const prgFile = data.prg_file || Object.keys(this.queueCache).find(key => 
      this.queueCache[key].status === data.status && this.queueCache[key].type === data.type
    );
    
    if (prgFile) {
      const queueId = Object.keys(this.queueEntries).find(id => 
        this.queueEntries[id].prgFile === prgFile
      );
      if (queueId) {
        queueItem = this.queueEntries[queueId];
      }
    }
    
    // Extract common fields
    const trackName = data.song || data.music || data.name || data.title || 
                      (queueItem?.item?.name) || 'Unknown';
    const artist = data.artist || data.artist_name || 
                   (queueItem?.item?.artist) || '';
    const albumTitle = data.title || data.album || data.parent?.title || data.name || 
                      (queueItem?.item?.name) || '';
    const playlistName = data.name || data.parent?.name || 
                        (queueItem?.item?.name) || '';
    const playlistOwner = data.owner || data.parent?.owner || 
                         (queueItem?.item?.owner) || '';
    const currentTrack = data.current_track || data.parsed_current_track || '';
    const totalTracks = data.total_tracks || data.parsed_total_tracks || data.parent?.total_tracks || 
                       (queueItem?.item?.total_tracks) || '';
    
    // Format percentage for display when available
    let formattedPercentage = '0';
    if (data.progress !== undefined) {
      formattedPercentage = parseFloat(data.progress).toFixed(1);
    } else if (data.percentage) {
      formattedPercentage = (parseFloat(data.percentage) * 100).toFixed(1);
    } else if (data.percent) {
      formattedPercentage = (parseFloat(data.percent) * 100).toFixed(1);
    }
    
    // Helper for constructing info about the parent item
    const getParentInfo = () => {
      if (!data.parent) return '';
      
      if (data.parent.type === 'album') {
        return ` from album "${data.parent.title}"`;
      } else if (data.parent.type === 'playlist') {
        return ` from playlist "${data.parent.name}" by ${data.parent.owner}`;
      }
      return '';
    };
    
    // Status-based message generation
    switch (data.status) {
      case 'queued':
        if (data.type === 'track') {
          return `Queued track "${trackName}"${artist ? ` by ${artist}` : ''}${getParentInfo()}`;
        } else if (data.type === 'album') {
          return `Queued album "${albumTitle}"${artist ? ` by ${artist}` : ''} (${totalTracks || '?'} tracks)`;
        } else if (data.type === 'playlist') {
          return `Queued playlist "${playlistName}"${playlistOwner ? ` by ${playlistOwner}` : ''} (${totalTracks || '?'} tracks)`;
        }
        return `Queued ${data.type}`;
      
      case 'initializing':
        return `Preparing to download...`;
      
      case 'processing':
        // Special case: If this is a track that's part of an album/playlist
        if (data.type === 'track' && data.parent) {
          if (data.parent.type === 'album') {
            return `Processing track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} (from album "${data.parent.title}")`;
          } else if (data.parent.type === 'playlist') {
            return `Processing track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} (from playlist "${data.parent.name}")`;
          }
        }
        
        // Regular standalone track
        if (data.type === 'track') {
          return `Processing track "${trackName}"${artist ? ` by ${artist}` : ''}${getParentInfo()}`;
        } 
        // Album download
        else if (data.type === 'album') {
          // For albums, show current track info if available
          if (trackName && artist && currentTrack && totalTracks) {
            return `Processing track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist}`;
          } else if (currentTrack && totalTracks) {
            // If we have track numbers but not names
            return `Processing track ${currentTrack} of ${totalTracks} from album "${albumTitle}"`;
          } else if (totalTracks) {
            return `Processing album "${albumTitle}" (${totalTracks} tracks)`;
          }
          return `Processing album "${albumTitle}"...`;
        } 
        // Playlist download
        else if (data.type === 'playlist') {
          // For playlists, show current track info if available
          if (trackName && artist && currentTrack && totalTracks) {
            return `Processing track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist}`;
          } else if (currentTrack && totalTracks) {
            // If we have track numbers but not names
            return `Processing track ${currentTrack} of ${totalTracks} from playlist "${playlistName}"`;
          } else if (totalTracks) {
            return `Processing playlist "${playlistName}" (${totalTracks} tracks)`;
          }
          return `Processing playlist "${playlistName}"...`;
        }
        return `Processing ${data.type}...`;
        
      case 'progress':
        // Special case: If this is a track that's part of an album/playlist
        if (data.type === 'track' && data.parent) {
          if (data.parent.type === 'album') {
            return `Downloading track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} (from album "${data.parent.title}")`;
          } else if (data.parent.type === 'playlist') {
            return `Downloading track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} (from playlist "${data.parent.name}")`;
          }
        }
        
        // Regular standalone track
        if (data.type === 'track') {
          return `Downloading track "${trackName}"${artist ? ` by ${artist}` : ''}${getParentInfo()}`;
        } 
        // Album download
        else if (data.type === 'album') {
          // For albums, show current track info if available
          if (trackName && artist && currentTrack && totalTracks) {
            return `Downloading track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist}`;
          } else if (currentTrack && totalTracks) {
            // If we have track numbers but not names
            return `Downloading track ${currentTrack} of ${totalTracks} from album "${albumTitle}"`;
          } else if (totalTracks) {
            return `Downloading album "${albumTitle}" (${totalTracks} tracks)`;
          }
          return `Downloading album "${albumTitle}"...`;
        } 
        // Playlist download
        else if (data.type === 'playlist') {
          // For playlists, show current track info if available
          if (trackName && artist && currentTrack && totalTracks) {
            return `Downloading track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist}`;
          } else if (currentTrack && totalTracks) {
            // If we have track numbers but not names
            return `Downloading track ${currentTrack} of ${totalTracks} from playlist "${playlistName}"`;
          } else if (totalTracks) {
            return `Downloading playlist "${playlistName}" (${totalTracks} tracks)`;
          }
          return `Downloading playlist "${playlistName}"...`;
        }
        return `Downloading ${data.type}...`;
      
      case 'real-time':
      case 'real_time':
        // Special case: If this is a track that's part of an album/playlist
        if (data.type === 'track' && data.parent) {
          if (data.parent.type === 'album') {
            return `Downloading track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} - ${formattedPercentage}% (from album "${data.parent.title}")`;
          } else if (data.parent.type === 'playlist') {
            return `Downloading track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} - ${formattedPercentage}% (from playlist "${data.parent.name}")`;
          }
        }
        
        // Regular standalone track
        if (data.type === 'track') {
          return `Downloading "${trackName}" - ${formattedPercentage}%${getParentInfo()}`;
        } 
        // Album with track info
        else if (data.type === 'album' && trackName && artist) {
          return `Downloading ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} - ${formattedPercentage}%`;
        } 
        // Playlist with track info
        else if (data.type === 'playlist' && trackName && artist) {
          return `Downloading ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} - ${formattedPercentage}%`;
        } 
        // Generic with percentage
        else {
          const itemName = data.type === 'album' ? albumTitle : 
                         (data.type === 'playlist' ? playlistName : data.type);
          return `Downloading ${data.type} "${itemName}" - ${formattedPercentage}%`;
        }
      
      case 'done':
      case 'complete':
        if (data.type === 'track') {
          return `Downloaded "${trackName}"${artist ? ` by ${artist}` : ''} successfully${getParentInfo()}`;
        } else if (data.type === 'album') {
          return `Downloaded album "${albumTitle}"${artist ? ` by ${artist}` : ''} successfully (${totalTracks} tracks)`;
        } else if (data.type === 'playlist') {
          return `Downloaded playlist "${playlistName}"${playlistOwner ? ` by ${playlistOwner}` : ''} successfully (${totalTracks} tracks)`;
        }
        return `Downloaded ${data.type} successfully`;
      
      case 'skipped':
        return `${trackName}${artist ? ` by ${artist}` : ''} was skipped: ${data.reason || 'Unknown reason'}`;
      
      case 'error':
        // Enhanced error message handling using the new format
        let errorMsg = `Error: ${data.error || data.message || 'Unknown error'}`;
        
        // Add position information for tracks in collections
        if (data.current_track && data.total_tracks) {
          errorMsg = `Error on track ${data.current_track}/${data.total_tracks}: ${data.error || data.message || 'Unknown error'}`;
        }
        
        // Add retry information if available
        if (data.retry_count !== undefined) {
          errorMsg += ` (Attempt ${data.retry_count}/${this.MAX_RETRIES})`;
        } else if (data.can_retry !== undefined) {
          if (data.can_retry) {
            errorMsg += ` (Can be retried)`;
          } else {
            errorMsg += ` (Max retries reached)`;
          }
        }
        
        // Add parent information if this is a track with a parent
        if (data.type === 'track' && data.parent) {
          if (data.parent.type === 'album') {
            errorMsg += `\nFrom album: "${data.parent.title}" by ${data.parent.artist || 'Unknown artist'}`;
          } else if (data.parent.type === 'playlist') {
            errorMsg += `\nFrom playlist: "${data.parent.name}" by ${data.parent.owner || 'Unknown creator'}`;
          }
        }
        
        // Add URL for troubleshooting if available
        if (data.url) {
          errorMsg += `\nSource: ${data.url}`;
        }
        
        return errorMsg;
      
      case 'retrying':
        let retryMsg = 'Retrying';
        if (data.retry_count) {
          retryMsg += ` (${data.retry_count}/${this.MAX_RETRIES})`;
        }
        if (data.seconds_left) {
          retryMsg += ` in ${data.seconds_left}s`;
        }
        if (data.error) {
          retryMsg += `: ${data.error}`;
        }
        return retryMsg;
      
      case 'cancelled':
      case 'cancel':
        return 'Cancelling...';
      
      default:
        return data.status || 'Unknown status';
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
    
    // Mark the entry as retrying to prevent automatic cleanup
    entry.isRetrying = true;
    logElement.textContent = 'Retrying download...';
    
    // Determine if we should use parent information for retry
    let useParent = false;
    let parentType = null;
    let parentUrl = null;
    
    // Check if we have parent information in the lastStatus
    if (entry.lastStatus && entry.lastStatus.parent) {
      const parent = entry.lastStatus.parent;
      if (parent.type && parent.url) {
        useParent = true;
        parentType = parent.type;
        parentUrl = parent.url;
        console.log(`Using parent info for retry: ${parentType} with URL: ${parentUrl}`);
      }
    }
    
    // Find a retry URL from various possible sources
    const getRetryUrl = () => {
      // If using parent, return parent URL
      if (useParent && parentUrl) {
        return parentUrl;
      }
      
      // Otherwise use the standard fallback options
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
      entry.isRetrying = false; // Reset retrying flag
      return;
    }
    
    try {
      // Close any existing polling interval
      this.clearPollingInterval(queueId);
      
      // Determine which type to use for the API endpoint
      const apiType = useParent ? parentType : entry.type;
      console.log(`Retrying download using type: ${apiType} with URL: ${retryUrl}`);
      
      // Build the API URL based on the determined type
      const apiUrl = `/api/${apiType}/download?url=${encodeURIComponent(retryUrl)}`;
      
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
        // Store the old PRG file for cleanup
        const oldPrgFile = entry.prgFile;
        
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
        
        // Set up a new polling interval for the retried download
        this.setupPollingInterval(queueId);
        
        // Delete the old PRG file after a short delay to ensure the new one is properly set up
        if (oldPrgFile) {
          setTimeout(async () => {
            try {
              await fetch(`/api/prgs/delete/${oldPrgFile}`, { method: 'DELETE' });
              console.log(`Cleaned up old PRG file: ${oldPrgFile}`);
            } catch (deleteError) {
              console.error('Error deleting old PRG file:', deleteError);
            }
          }, 2000); // Wait 2 seconds before deleting the old file
        }
      } else {
        logElement.textContent = 'Retry failed: invalid response from server';
        entry.isRetrying = false; // Reset retrying flag
      }
    } catch (error) {
      console.error('Retry error:', error);
      logElement.textContent = 'Retry failed: ' + error.message;
      entry.isRetrying = false; // Reset retrying flag
    }
  }

  /**
   * Start monitoring for all active entries in the queue that are visible
   */
  startMonitoringActiveEntries() {
    for (const queueId in this.queueEntries) {
      const entry = this.queueEntries[queueId];
      // Only start monitoring if the entry is not in a terminal state and is visible
      if (!entry.hasEnded && this.isEntryVisible(queueId) && !this.pollingIntervals[queueId]) {
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
    
    // Build the API URL with only the URL parameter as it's all that's needed
    let apiUrl = `/api/${type}/download?url=${encodeURIComponent(url)}`;
    
    // For artist downloads, include album_type as it may still be needed
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
          console.log(`Queued artist discography with ${data.task_ids.length} albums`);
          
          // Make queue visible to show progress
          this.toggleVisibility(true);
          
          // Create entries directly from task IDs and start monitoring them
          const queueIds = [];
          for (const taskId of data.task_ids) {
            console.log(`Adding album task with ID: ${taskId}`);
            // Create an album item with better display information
            const albumItem = {
              name: `${item.name || 'Artist'} - Album (loading...)`, 
              artist: item.name || 'Unknown artist',
              type: 'album'
            };
            // Use improved addDownload with forced monitoring
            const queueId = this.addDownload(albumItem, 'album', taskId, apiUrl, true);
            queueIds.push(queueId);
          }
          
          return queueIds;
        } 
        // Check for older API response format
        else if (data.album_prg_files && Array.isArray(data.album_prg_files)) {
          console.log(`Queued artist discography with ${data.album_prg_files.length} albums (old format)`);
          
          // Make queue visible to show progress
          this.toggleVisibility(true);
          
          // Add each album to the download queue separately with forced monitoring
          const queueIds = [];
          data.album_prg_files.forEach(prgFile => {
            console.log(`Adding album with PRG file: ${prgFile}`);
            // Create an album item with better display information
            const albumItem = {
              name: `${item.name || 'Artist'} - Album (loading...)`, 
              artist: item.name || 'Unknown artist',
              type: 'album'
            };
            // Use improved addDownload with forced monitoring
            const queueId = this.addDownload(albumItem, 'album', prgFile, apiUrl, true);
            queueIds.push(queueId);
          });
          
          return queueIds;
        }
        // Handle any other response format for artist downloads
        else {
          console.log(`Queued artist discography with unknown format:`, data);
          
          // Make queue visible
          this.toggleVisibility(true);
          
          // Just load existing PRG files as a fallback
          await this.loadExistingPrgFiles();
          
          // Force start monitoring for all loaded entries
          for (const queueId in this.queueEntries) {
            const entry = this.queueEntries[queueId];
            if (!entry.hasEnded) {
              this.startDownloadStatusMonitoring(queueId);
            }
          }
          
          return data;
        }
      }
      
      // Handle single-file downloads (tracks, albums, playlists)
      if (data.prg_file) {
        console.log(`Adding ${type} with PRG file: ${data.prg_file}`);
        
        // Store the initial metadata in the cache so it's available
        // even before the first status update
        this.queueCache[data.prg_file] = {
          type,
          status: 'initializing',
          name: item.name || 'Unknown',
          title: item.name || 'Unknown',
          artist: item.artist || (item.artists && item.artists.length > 0 ? item.artists[0].name : ''),
          owner: item.owner || (item.owner ? item.owner.display_name : ''),
          total_tracks: item.total_tracks || 0
        };
        
        // Use direct monitoring for all downloads for consistency
        const queueId = this.addDownload(item, type, data.prg_file, apiUrl, true);
        
        // Make queue visible to show progress if not already visible
        if (!this.config.downloadQueueVisible) {
          this.toggleVisibility(true);
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
          let lastLineData = prgData.last_line || {};
          
          // First check if this is a track with a parent (part of an album/playlist)
          let itemType = lastLineData.type || prgData.display_type || originalRequest.display_type || originalRequest.type || 'unknown';
          let dummyItem = {};
          
          // If this is a track with a parent, treat it as the parent type for UI purposes
          if (lastLineData.type === 'track' && lastLineData.parent) {
            const parent = lastLineData.parent;
            
            if (parent.type === 'album') {
              itemType = 'album';
              dummyItem = {
                name: parent.title || 'Unknown Album',
                artist: parent.artist || 'Unknown Artist',
                type: 'album',
                total_tracks: parent.total_tracks || 0,
                url: parent.url || '',
                // Keep track of the current track info for progress display
                current_track: lastLineData.current_track,
                total_tracks: parent.total_tracks || lastLineData.total_tracks,
                // Store parent info directly in the item
                parent: parent
              };
            } else if (parent.type === 'playlist') {
              itemType = 'playlist';
              dummyItem = {
                name: parent.name || 'Unknown Playlist',
                owner: parent.owner || 'Unknown Creator',
                type: 'playlist',
                total_tracks: parent.total_tracks || 0,
                url: parent.url || '',
                // Keep track of the current track info for progress display
                current_track: lastLineData.current_track,
                total_tracks: parent.total_tracks || lastLineData.total_tracks,
                // Store parent info directly in the item
                parent: parent
              };
            }
          } else {
            // Use the explicit display fields if available, or fall back to other fields
            dummyItem = {
              name: prgData.display_title || originalRequest.display_title || lastLineData.name || lastLineData.song || lastLineData.title || originalRequest.name || prgFile,
              artist: prgData.display_artist || originalRequest.display_artist || lastLineData.artist || originalRequest.artist || '',
              type: itemType,
              url: originalRequest.url || lastLineData.url || '',
              endpoint: originalRequest.endpoint || '',
              download_type: originalRequest.download_type || '',
              // Include any available track info
              song: lastLineData.song,
              title: lastLineData.title,
              total_tracks: lastLineData.total_tracks,
              current_track: lastLineData.current_track
            };
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
          const entry = this.createQueueEntry(dummyItem, itemType, prgFile, queueId, requestUrl);
          entry.retryCount = retryCount;
          
          // Set the entry's last status from the PRG file
          if (prgData.last_line) {
            entry.lastStatus = prgData.last_line;
            
            // If this is a track that's part of an album/playlist
            if (prgData.last_line.parent) {
              entry.parentInfo = prgData.last_line.parent;
            }
            
            // Make sure to save the status to the cache for persistence
            this.queueCache[prgFile] = prgData.last_line;
            
            // Apply proper status classes
            this.applyStatusClasses(entry, prgData.last_line);
            
            // Update log display with current info
            const logElement = entry.element.querySelector('.log');
            if (logElement) {
              if (prgData.last_line.song && prgData.last_line.artist && 
                  ['progress', 'real-time', 'real_time', 'processing', 'downloading'].includes(prgData.last_line.status)) {
                logElement.textContent = `Currently downloading: ${prgData.last_line.song} by ${prgData.last_line.artist}`;
              } else if (entry.parentInfo && !['done', 'complete', 'error', 'skipped'].includes(prgData.last_line.status)) {
                // Show parent info for non-terminal states
                if (entry.parentInfo.type === 'album') {
                  logElement.textContent = `From album: ${entry.parentInfo.title}`;
                } else if (entry.parentInfo.type === 'playlist') {
                  logElement.textContent = `From playlist: ${entry.parentInfo.name} by ${entry.parentInfo.owner}`;
                }
              }
            }
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

  /* Sets up a polling interval for real-time status updates */
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
      
      // Create a polling interval of 500ms for more responsive UI updates
      const intervalId = setInterval(() => {
        this.fetchDownloadStatus(queueId);
      }, 500);
      
      // Store the interval ID for later cleanup
      this.pollingIntervals[queueId] = intervalId;
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
      
      // If the last_line doesn't have name/artist/title info, add it from our stored item data
      if (data.last_line && entry.item) {
        if (!data.last_line.name && entry.item.name) {
          data.last_line.name = entry.item.name;
        }
        if (!data.last_line.title && entry.item.name) {
          data.last_line.title = entry.item.name;
        }
        if (!data.last_line.artist && entry.item.artist) {
          data.last_line.artist = entry.item.artist;
        } else if (!data.last_line.artist && entry.item.artists && entry.item.artists.length > 0) {
          data.last_line.artist = entry.item.artists[0].name;
        }
        if (!data.last_line.owner && entry.item.owner) {
          data.last_line.owner = entry.item.owner;
        }
        if (!data.last_line.total_tracks && entry.item.total_tracks) {
          data.last_line.total_tracks = entry.item.total_tracks;
        }
      }
      
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
      
      // Special handling for track updates that are part of an album/playlist
      // Don't filter these out as they contain important track progress info
      if (data.last_line && data.last_line.type === 'track' && data.last_line.parent) {
        // This is a track update that's part of an album/playlist - keep it
        if ((entry.type === 'album' && data.last_line.parent.type === 'album') ||
            (entry.type === 'playlist' && data.last_line.parent.type === 'playlist')) {
          console.log(`Processing track update for ${entry.type} download: ${data.last_line.song}`);
          // Continue processing - don't return
        }
      }
      // Only filter out updates that don't match entry type AND don't have a relevant parent
      else if (data.last_line && data.last_line.type && entry.type && 
               data.last_line.type !== entry.type && 
               (!data.last_line.parent || data.last_line.parent.type !== entry.type)) {
        console.log(`Skipping status update with type '${data.last_line.type}' for entry with type '${entry.type}'`);
        return;
      }
      
      // Process the update
      this.handleStatusUpdate(queueId, data);
      
      // Handle terminal states
      if (data.last_line && ['complete', 'error', 'cancelled', 'done'].includes(data.last_line.status)) {
        console.log(`Terminal state detected: ${data.last_line.status} for ${queueId}`);
        entry.hasEnded = true;
        
        // For cancelled downloads, clean up immediately
        if (data.last_line.status === 'cancelled' || data.last_line.status === 'cancel') {
          console.log('Cleaning up cancelled download immediately');
          this.clearPollingInterval(queueId);
          this.cleanupEntry(queueId);
          return; // No need to process further
        }
        
        // Only set up cleanup if this is not an error that we're in the process of retrying
        // If status is 'error' but the status message contains 'Retrying', don't clean up
        const isRetrying = entry.isRetrying || 
                          (data.last_line.status === 'error' && 
                           entry.element.querySelector('.log')?.textContent?.includes('Retry'));
        
        if (!isRetrying) {
          setTimeout(() => {
            // Double-check the entry still exists and has not been retried before cleaning up
            if (this.queueEntries[queueId] && 
                !this.queueEntries[queueId].isRetrying &&
                this.queueEntries[queueId].hasEnded) {
              this.clearPollingInterval(queueId);
              this.cleanupEntry(queueId);
            }
          }, 5000);
        }
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
    if (this.pollingIntervals[queueId]) {
      console.log(`Stopping polling for ${queueId}`);
      try {
        clearInterval(this.pollingIntervals[queueId]);
      } catch (error) {
        console.error(`Error stopping polling for ${queueId}:`, error);
      }
      delete this.pollingIntervals[queueId];
    }
  }

  /* Handle status updates from the progress API */
  handleStatusUpdate(queueId, data) {
    const entry = this.queueEntries[queueId];
    if (!entry) {
      console.warn(`No entry for ${queueId}`);
      return;
    }
    
    // Extract the actual status data from the API response
    const statusData = data.last_line || {};
    
    // Special handling for track status updates that are part of an album/playlist
    // We want to keep these for showing the track-by-track progress
    if (statusData.type === 'track' && statusData.parent) {
      // If this is a track that's part of our album/playlist, keep it
      if ((entry.type === 'album' && statusData.parent.type === 'album') ||
          (entry.type === 'playlist' && statusData.parent.type === 'playlist')) {
        console.log(`Processing track status update for ${entry.type}: ${statusData.song}`);
      }
    }
    // Only skip updates where type doesn't match AND there's no relevant parent relationship
    else if (statusData.type && entry.type && statusData.type !== entry.type && 
             (!statusData.parent || statusData.parent.type !== entry.type)) {
      console.log(`Skipping mismatched type: update=${statusData.type}, entry=${entry.type}`);
      return;
    }
    
    // Get primary status
    const status = statusData.status || data.event || 'unknown';
    
    // Store the status data for potential retries
    entry.lastStatus = statusData;
    entry.lastUpdated = Date.now();
    
    // Update type if needed - could be more specific now (e.g., from 'album' to 'compilation')
    if (statusData.type && statusData.type !== entry.type) {
      entry.type = statusData.type;
      const typeEl = entry.element.querySelector('.type');
      if (typeEl) {
        const displayType = entry.type.charAt(0).toUpperCase() + entry.type.slice(1);
        typeEl.textContent = displayType;
        typeEl.className = `type ${entry.type}`;
      }
    }

    // Update the title and artist with better information if available
    this.updateItemMetadata(entry, statusData, data);
    
    // Generate appropriate user-friendly message
    const message = this.getStatusMessage(statusData);
    
    // Update log message - but only if we're not handling a track update for an album/playlist
    // That case is handled separately in updateItemMetadata to ensure we show the right track info
    const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
    if (logElement && !(statusData.type === 'track' && statusData.parent && 
        (entry.type === 'album' || entry.type === 'playlist'))) {
      logElement.textContent = message;
    }
    
    // Handle real-time progress data for single track downloads
    if (status === 'real-time') {
      this.updateRealTimeProgress(entry, statusData);
    }
    
    // Handle overall progress for albums and playlists
    const isMultiTrack = entry.type === 'album' || entry.type === 'playlist';
    if (isMultiTrack) {
      this.updateMultiTrackProgress(entry, statusData);
    } else {
      // For single tracks, update the track progress
      this.updateSingleTrackProgress(entry, statusData);
    }
    
    // Apply appropriate status classes
    this.applyStatusClasses(entry, status);
    
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
          
          // Don't set up automatic cleanup - let retryDownload function handle this
          // The automatic cleanup was causing items to disappear when retrying
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
          
          // Set up automatic cleanup after 10 seconds only if not retrying
          setTimeout(() => {
            if (this.queueEntries[queueId] && this.queueEntries[queueId].hasEnded && !this.queueEntries[queueId].isRetrying) {
              this.cleanupEntry(queueId);
            }
          }, 10000);
        }
      }
    }
    
    // Handle terminal states for non-error cases
    if (['complete', 'cancel', 'cancelled', 'done', 'skipped'].includes(status)) {
      entry.hasEnded = true;
      this.handleDownloadCompletion(entry, queueId, statusData);
    }
    
    // Cache the status for potential page reloads
    this.queueCache[entry.prgFile] = statusData;
    localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));
  }

  // Update item metadata (title, artist, etc.)
  updateItemMetadata(entry, statusData, data) {
    const titleEl = entry.element.querySelector('.title');
    const artistEl = entry.element.querySelector('.artist');
    
    if (titleEl) {
      // Check various data sources for a better title
      let betterTitle = null;
      
      // First check the statusData
      if (statusData.song) {
        betterTitle = statusData.song;
      } else if (statusData.album) {
        betterTitle = statusData.album;
      } else if (statusData.name) {
        betterTitle = statusData.name;
      }
      // Then check if data has original_request with name
      else if (data.original_request && data.original_request.name) {
        betterTitle = data.original_request.name;
      }
      // Then check display_title from various sources
      else if (statusData.display_title) {
        betterTitle = statusData.display_title;
      } else if (data.display_title) {
        betterTitle = data.display_title;
      }
      
      // Update title if we found a better one
      if (betterTitle && betterTitle !== titleEl.textContent) {
        titleEl.textContent = betterTitle;
        // Also update the item's name for future reference
        entry.item.name = betterTitle;
      }
    }
    
    // Update artist if available
    if (artistEl) {
      let artist = statusData.artist || data.display_artist || '';
      if (artist && (!artistEl.textContent || artistEl.textContent !== artist)) {
        artistEl.textContent = artist;
        // Update item data
        entry.item.artist = artist;
      }
    }
  }
  
  // Update real-time progress for track downloads
  updateRealTimeProgress(entry, statusData) {
    // Get track progress bar
    const trackProgressBar = entry.element.querySelector('#track-progress-bar-' + entry.uniqueId + '-' + entry.prgFile);
    const timeElapsedEl = entry.element.querySelector('#time-elapsed-' + entry.uniqueId + '-' + entry.prgFile);
    
    if (trackProgressBar && statusData.progress !== undefined) {
      // Update track progress bar
      const progress = parseFloat(statusData.progress);
      trackProgressBar.style.width = `${progress}%`;
      trackProgressBar.setAttribute('aria-valuenow', progress);
      
      // Add success class when complete
      if (progress >= 100) {
        trackProgressBar.classList.add('complete');
      } else {
        trackProgressBar.classList.remove('complete');
      }
    }
    
    // Display time elapsed if available
    if (timeElapsedEl && statusData.time_elapsed !== undefined) {
      const seconds = Math.floor(statusData.time_elapsed / 1000);
      const formattedTime = seconds < 60 
        ? `${seconds}s` 
        : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
      timeElapsedEl.textContent = formattedTime;
    }
  }
  
  // Update progress for single track downloads
  updateSingleTrackProgress(entry, statusData) {
    // Get track progress bar and other UI elements
    const trackProgressBar = entry.element.querySelector('#track-progress-bar-' + entry.uniqueId + '-' + entry.prgFile);
    const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
    const titleElement = entry.element.querySelector('.title');
    const artistElement = entry.element.querySelector('.artist');
    
    // If this track has a parent, this is actually part of an album/playlist
    // We should update the entry type and handle it as a multi-track download
    if (statusData.parent && (statusData.parent.type === 'album' || statusData.parent.type === 'playlist')) {
      // Store parent info
      entry.parentInfo = statusData.parent;
      
      // Update entry type to match parent type
      entry.type = statusData.parent.type;
      
      // Update UI to reflect the parent type
      const typeEl = entry.element.querySelector('.type');
      if (typeEl) {
        const displayType = entry.type.charAt(0).toUpperCase() + entry.type.slice(1);
        typeEl.textContent = displayType;
        typeEl.className = `type ${entry.type}`;
      }
      
      // Update title and subtitle based on parent type
      if (statusData.parent.type === 'album') {
        if (titleElement) titleElement.textContent = statusData.parent.title || 'Unknown album';
        if (artistElement) artistElement.textContent = statusData.parent.artist || 'Unknown artist';
      } else if (statusData.parent.type === 'playlist') {
        if (titleElement) titleElement.textContent = statusData.parent.name || 'Unknown playlist';
        if (artistElement) artistElement.textContent = statusData.parent.owner || 'Unknown creator';
      }
      
      // Now delegate to the multi-track progress updater
      this.updateMultiTrackProgress(entry, statusData);
      return;
    }
    
    // For standalone tracks (without parent), update title and subtitle
    if (!statusData.parent && statusData.song && titleElement) {
      titleElement.textContent = statusData.song;
    }
    
    if (!statusData.parent && statusData.artist && artistElement) {
      artistElement.textContent = statusData.artist;
    }
    
    // For individual track downloads, show the parent context if available
    if (!['done', 'complete', 'error', 'skipped'].includes(statusData.status)) {
      // First check if we have parent data in the current status update
      if (statusData.parent && logElement) {
        // Store parent info in the entry for persistence across refreshes
        entry.parentInfo = statusData.parent;
        
        let infoText = '';
        if (statusData.parent.type === 'album') {
          infoText = `From album: ${statusData.parent.title}`;
        } else if (statusData.parent.type === 'playlist') {
          infoText = `From playlist: ${statusData.parent.name} by ${statusData.parent.owner}`;
        }
        
        if (infoText) {
          logElement.textContent = infoText;
        }
      } 
      // If no parent in current update, use stored parent info if available
      else if (entry.parentInfo && logElement) {
        let infoText = '';
        if (entry.parentInfo.type === 'album') {
          infoText = `From album: ${entry.parentInfo.title}`;
        } else if (entry.parentInfo.type === 'playlist') {
          infoText = `From playlist: ${entry.parentInfo.name} by ${entry.parentInfo.owner}`;
        }
        
        if (infoText) {
          logElement.textContent = infoText;
        }
      }
    }
    
    // Calculate progress based on available data
    let progress = 0;
    
    // Real-time progress for direct track download
    if (statusData.status === 'real-time' && statusData.progress !== undefined) {
      progress = parseFloat(statusData.progress);
    } else if (statusData.percent !== undefined) {
      progress = parseFloat(statusData.percent) * 100;
    } else if (statusData.percentage !== undefined) {
      progress = parseFloat(statusData.percentage) * 100;
    } else if (statusData.status === 'done' || statusData.status === 'complete') {
      progress = 100;
    } else if (statusData.current_track && statusData.total_tracks) {
      // If we don't have real-time progress but do have track position
      progress = (parseInt(statusData.current_track, 10) / parseInt(statusData.total_tracks, 10)) * 100;
    }
    
    // Update track progress bar if available
    if (trackProgressBar) {
      // Ensure numeric progress and prevent NaN
      const safeProgress = isNaN(progress) ? 0 : Math.max(0, Math.min(100, progress));
      
      trackProgressBar.style.width = `${safeProgress}%`;
      trackProgressBar.setAttribute('aria-valuenow', safeProgress);
      
      // Make sure progress bar is visible
      const trackProgressContainer = entry.element.querySelector('#track-progress-container-' + entry.uniqueId + '-' + entry.prgFile);
      if (trackProgressContainer) {
        trackProgressContainer.style.display = 'block';
      }
      
      // Add success class when complete
      if (safeProgress >= 100) {
        trackProgressBar.classList.add('complete');
      } else {
        trackProgressBar.classList.remove('complete');
      }
    }
  }
  
  // Update progress for multi-track downloads (albums and playlists)
  updateMultiTrackProgress(entry, statusData) {
    // Get progress elements
    const progressCounter = document.getElementById(`progress-count-${entry.uniqueId}-${entry.prgFile}`);
    const overallProgressBar = document.getElementById(`overall-bar-${entry.uniqueId}-${entry.prgFile}`);
    const trackProgressBar = entry.element.querySelector('#track-progress-bar-' + entry.uniqueId + '-' + entry.prgFile);
    const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
    const titleElement = entry.element.querySelector('.title');
    const artistElement = entry.element.querySelector('.artist');
    
    // Initialize track progress variables
    let currentTrack = 0;
    let totalTracks = 0;
    let trackProgress = 0;
    
    // Handle track-level updates for album/playlist downloads
    if (statusData.type === 'track' && statusData.parent && 
        (entry.type === 'album' || entry.type === 'playlist')) {
      console.log('Processing track update for multi-track download:', statusData);
      
      // Update parent title/artist for album
      if (entry.type === 'album' && statusData.parent.type === 'album') {
        if (titleElement && statusData.parent.title) {
          titleElement.textContent = statusData.parent.title;
        }
        if (artistElement && statusData.parent.artist) {
          artistElement.textContent = statusData.parent.artist;
        }
      } 
      // Update parent title/owner for playlist
      else if (entry.type === 'playlist' && statusData.parent.type === 'playlist') {
        if (titleElement && statusData.parent.name) {
          titleElement.textContent = statusData.parent.name;
        }
        if (artistElement && statusData.parent.owner) {
          artistElement.textContent = statusData.parent.owner;
        }
      }
      
      // Get current track and total tracks from the status data
      if (statusData.current_track !== undefined) {
        currentTrack = parseInt(statusData.current_track, 10);
        
        // Get total tracks - try from statusData first, then from parent
        if (statusData.total_tracks !== undefined) {
          totalTracks = parseInt(statusData.total_tracks, 10);
        } else if (statusData.parent && statusData.parent.total_tracks !== undefined) {
          totalTracks = parseInt(statusData.parent.total_tracks, 10);
        }
        
        console.log(`Track info: ${currentTrack}/${totalTracks}`);
      }
      
      // Get track progress for real-time updates
      if (statusData.status === 'real-time' && statusData.progress !== undefined) {
        trackProgress = parseFloat(statusData.progress);
      }
      
      // Update the track progress counter display
      if (progressCounter && totalTracks > 0) {
        progressCounter.textContent = `${currentTrack}/${totalTracks}`;
      }
      
      // Update the status message to show current track
      if (logElement && statusData.song && statusData.artist) {
        let progressInfo = '';
        if (statusData.status === 'real-time' && trackProgress > 0) {
          progressInfo = ` - ${trackProgress.toFixed(1)}%`;
        }
        logElement.textContent = `Currently downloading: ${statusData.song} by ${statusData.artist} (${currentTrack}/${totalTracks}${progressInfo})`;
      }
      
      // Calculate and update the overall progress bar
      if (totalTracks > 0) {
        let overallProgress = 0;
        
        if (statusData.status === 'real-time' && trackProgress !== undefined) {
          // Use the formula: ((current_track-1)/(total_tracks))+(1/total_tracks*progress)
          const completedTracksProgress = (currentTrack - 1) / totalTracks;
          const currentTrackContribution = (1 / totalTracks) * (trackProgress / 100);
          overallProgress = (completedTracksProgress + currentTrackContribution) * 100;
          console.log(`Real-time overall progress: ${overallProgress.toFixed(2)}% (Track ${currentTrack}/${totalTracks}, Progress: ${trackProgress}%)`);
        } else {
          // Standard progress calculation based on current track position
          overallProgress = (currentTrack / totalTracks) * 100;
          console.log(`Standard overall progress: ${overallProgress.toFixed(2)}% (Track ${currentTrack}/${totalTracks})`);
        }
        
        // Update the progress bar
        if (overallProgressBar) {
          const safeProgress = Math.max(0, Math.min(100, overallProgress));
          overallProgressBar.style.width = `${safeProgress}%`;
          overallProgressBar.setAttribute('aria-valuenow', safeProgress);
          
          if (safeProgress >= 100) {
            overallProgressBar.classList.add('complete');
          } else {
            overallProgressBar.classList.remove('complete');
          }
        }
        
        // Update the track-level progress bar
        if (trackProgressBar) {
          // Make sure progress bar container is visible
          const trackProgressContainer = entry.element.querySelector('#track-progress-container-' + entry.uniqueId + '-' + entry.prgFile);
          if (trackProgressContainer) {
            trackProgressContainer.style.display = 'block';
          }
          
          if (statusData.status === 'real-time') {
            // Real-time progress for the current track
            const safeTrackProgress = Math.max(0, Math.min(100, trackProgress));
            trackProgressBar.style.width = `${safeTrackProgress}%`;
            trackProgressBar.setAttribute('aria-valuenow', safeTrackProgress);
            trackProgressBar.classList.add('real-time');
            
            if (safeTrackProgress >= 100) {
              trackProgressBar.classList.add('complete');
            } else {
              trackProgressBar.classList.remove('complete');
            }
          } else {
            // Indeterminate progress animation for non-real-time updates
            trackProgressBar.classList.add('progress-pulse');
            trackProgressBar.style.width = '100%';
            trackProgressBar.setAttribute('aria-valuenow', 50);
          }
        }
        
        // Store progress for potential later use
        entry.progress = overallProgress;
      }
      
      return; // Skip the standard handling below
    }
    
    // Standard handling for album/playlist direct updates (not track-level):
    // Update title and subtitle based on item type
    if (entry.type === 'album') {
      if (statusData.title && titleElement) {
        titleElement.textContent = statusData.title;
      }
      if (statusData.artist && artistElement) {
        artistElement.textContent = statusData.artist;
      }
    } else if (entry.type === 'playlist') {
      if (statusData.name && titleElement) {
        titleElement.textContent = statusData.name;
      }
      if (statusData.owner && artistElement) {
        artistElement.textContent = statusData.owner;
      }
    }
    
    // Extract track counting data from status data
    if (statusData.current_track && statusData.total_tracks) {
      currentTrack = parseInt(statusData.current_track, 10);
      totalTracks = parseInt(statusData.total_tracks, 10);
    } else if (statusData.parsed_current_track && statusData.parsed_total_tracks) {
      currentTrack = parseInt(statusData.parsed_current_track, 10);
      totalTracks = parseInt(statusData.parsed_total_tracks, 10);
    } else if (statusData.current_track && /^\d+\/\d+$/.test(statusData.current_track)) {
      // Parse formats like "1/12"
      const parts = statusData.current_track.split('/');
      currentTrack = parseInt(parts[0], 10);
      totalTracks = parseInt(parts[1], 10);
    }
    
    // Get track progress for real-time downloads
    if (statusData.status === 'real-time' && statusData.progress !== undefined) {
      // For real-time downloads, progress comes as a percentage value (0-100)
      trackProgress = parseFloat(statusData.progress);
    } else if (statusData.percent !== undefined) {
      // Handle percent values (0-1)
      trackProgress = parseFloat(statusData.percent) * 100;
    } else if (statusData.percentage !== undefined) {
      // Handle percentage values (0-1)
      trackProgress = parseFloat(statusData.percentage) * 100;
    }
    
    // Update progress counter if available
    if (progressCounter && totalTracks > 0) {
      progressCounter.textContent = `${currentTrack}/${totalTracks}`;
    }
    
    // Calculate overall progress
    let overallProgress = 0;
    if (totalTracks > 0) {
      // If we have an explicit overall_progress, use it
      if (statusData.overall_progress !== undefined) {
        overallProgress = parseFloat(statusData.overall_progress);
      } else if (statusData.status === 'real-time' && trackProgress !== undefined) {
        // Calculate based on formula: ((current_track-1)/(total_tracks))+(1/total_tracks*progress)
        // This gives a precise calculation for real-time downloads
        const completedTracksProgress = (currentTrack - 1) / totalTracks;
        const currentTrackContribution = (1 / totalTracks) * (trackProgress / 100);
        overallProgress = (completedTracksProgress + currentTrackContribution) * 100;
        console.log(`Real-time progress: Track ${currentTrack}/${totalTracks}, Track progress: ${trackProgress}%, Overall: ${overallProgress.toFixed(2)}%`);
      } else {
        // For non-real-time downloads, show percentage of tracks downloaded
        // Using current_track relative to total_tracks
        overallProgress = (currentTrack / totalTracks) * 100;
        console.log(`Standard progress: Track ${currentTrack}/${totalTracks}, Overall: ${overallProgress.toFixed(2)}%`);
      }
      
      // Update overall progress bar
      if (overallProgressBar) {
        // Ensure progress is between 0-100
        const safeProgress = Math.max(0, Math.min(100, overallProgress));
        overallProgressBar.style.width = `${safeProgress}%`;
        overallProgressBar.setAttribute('aria-valuenow', safeProgress);
        
        // Add success class when complete
        if (safeProgress >= 100) {
          overallProgressBar.classList.add('complete');
        } else {
          overallProgressBar.classList.remove('complete');
        }
      }
      
      // Update track progress bar for current track in multi-track items
      if (trackProgressBar) {
        // Make sure progress bar container is visible
        const trackProgressContainer = entry.element.querySelector('#track-progress-container-' + entry.uniqueId + '-' + entry.prgFile);
        if (trackProgressContainer) {
          trackProgressContainer.style.display = 'block';
        }
        
        if (statusData.status === 'real-time' || statusData.status === 'real_time') {
          // For real-time updates, use the track progress for the small green progress bar
          // This shows download progress for the current track only
          const safeProgress = isNaN(trackProgress) ? 0 : Math.max(0, Math.min(100, trackProgress));
          trackProgressBar.style.width = `${safeProgress}%`;
          trackProgressBar.setAttribute('aria-valuenow', safeProgress);
          trackProgressBar.classList.add('real-time');
          
          if (safeProgress >= 100) {
            trackProgressBar.classList.add('complete');
          } else {
            trackProgressBar.classList.remove('complete');
          }
        } else if (['progress', 'processing'].includes(statusData.status)) {
          // For non-real-time progress updates, show an indeterminate-style progress
          // by using a pulsing animation via CSS
          trackProgressBar.classList.add('progress-pulse');
          trackProgressBar.style.width = '100%';
          trackProgressBar.setAttribute('aria-valuenow', 50); // indicate in-progress
        } else {
          // For other status updates, use current track position
          trackProgressBar.classList.remove('progress-pulse');
          const trackPositionPercent = currentTrack > 0 ? 100 : 0;
          trackProgressBar.style.width = `${trackPositionPercent}%`;
          trackProgressBar.setAttribute('aria-valuenow', trackPositionPercent);
        }
      }
      
      // Store the progress in the entry for potential later use
      entry.progress = overallProgress;
    }
  }
  
  /* Close all active polling intervals */
  clearAllPollingIntervals() {
    for (const queueId in this.pollingIntervals) {
      this.clearPollingInterval(queueId);
    }
  }
}

// Singleton instance
export const downloadQueue = new DownloadQueue();
