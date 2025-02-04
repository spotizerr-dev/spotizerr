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
  
    addDownload(item, type, prgFile) {
      const queueId = this.generateQueueId();
      const entry = this.createQueueEntry(item, type, prgFile, queueId);
      
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
        const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
        if (entry.hasEnded) {
          clearInterval(entry.intervalId);
          return;
        }
  
        try {
          const response = await fetch(`/api/prgs/${entry.prgFile}`);
          const data = await response.json();
          const progress = data.last_line;
  
          if (!progress) {
            this.handleInactivity(entry, queueId, logElement);
            return;
          }
  
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
  
    createQueueEntry(item, type, prgFile, queueId) {
      return {
        item,
        type,
        prgFile,
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
          // If the word already ends with an "s", assume it's plural.
          return word.endsWith('s') ? word : word + 's';
        }
      
        switch (data.status) {
          case 'downloading':
            // For track downloads only.
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
              // Prefer an explicit subsets array if available.
              if (data.subsets && Array.isArray(data.subsets) && data.subsets.length > 0) {
                subsets = data.subsets;
              }
              // Otherwise, if album_type is provided, split it into an array.
              else if (data.album_type) {
                subsets = data.album_type
                  .split(',')
                  .map(item => item.trim())
                  .map(item => pluralize(item));
              }
              if (subsets.length > 0) {
                const subsetsMessage = formatList(subsets);
                return `Initializing download for ${data.artist}'s ${subsetsMessage}`;
              }
              // Fallback message if neither subsets nor album_type are provided.
              return `Initializing download for ${data.artist} with ${data.total_albums} album(s) [${data.album_type}]...`;
            }
            return `Initializing ${data.type} download...`;
      
          case 'progress':
            // Expect progress messages for playlists, albums (or artist’s albums) to include a "track" and "current_track".
            if (data.track && data.current_track) {
              // current_track is a string in the format "current/total"
              const parts = data.current_track.split('/');
              const current = parts[0];
              const total = parts[1] || '?';
      
              if (data.type === 'playlist') {
                return `Downloading playlist: Track ${current} of ${total} - ${data.track}`;
              } else if (data.type === 'album') {
                // For album progress, the "album" and "artist" fields may be available on a done message.
                // In some cases (like artist downloads) only track info is passed.
                if (data.album && data.artist) {
                  return `Downloading album "${data.album}" by ${data.artist}: track ${current} of ${total} - ${data.track}`;
                } else {
                  return `Downloading track ${current} of ${total}: ${data.track} from ${data.album}`;
                }
              }
            }
            // Fallback if fields are missing:
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
            // Convert milliseconds to minutes and seconds.
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
  }
  
  // Singleton instance
  export const downloadQueue = new DownloadQueue();