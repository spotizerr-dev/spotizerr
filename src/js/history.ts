document.addEventListener('DOMContentLoaded', () => {
    const historyTableBody = document.getElementById('history-table-body') as HTMLTableSectionElement | null;
    const prevButton = document.getElementById('prev-page') as HTMLButtonElement | null;
    const nextButton = document.getElementById('next-page') as HTMLButtonElement | null;
    const pageInfo = document.getElementById('page-info') as HTMLSpanElement | null;
    const limitSelect = document.getElementById('limit-select') as HTMLSelectElement | null;
    const statusFilter = document.getElementById('status-filter') as HTMLSelectElement | null;
    const typeFilter = document.getElementById('type-filter') as HTMLSelectElement | null;
    const trackFilter = document.getElementById('track-filter') as HTMLSelectElement | null;
    const hideChildTracksCheckbox = document.getElementById('hide-child-tracks') as HTMLInputElement | null;

    let currentPage = 1;
    let limit = 25;
    let totalEntries = 0;
    let currentSortBy = 'timestamp_completed';
    let currentSortOrder = 'DESC';
    let currentParentTaskId: string | null = null;

    async function fetchHistory(page = 1) {
        if (!historyTableBody || !prevButton || !nextButton || !pageInfo || !limitSelect || !statusFilter || !typeFilter) {
            console.error('One or more critical UI elements are missing for history page.');
            return;
        }

        const offset = (page - 1) * limit;
        let apiUrl = `/api/history?limit=${limit}&offset=${offset}&sort_by=${currentSortBy}&sort_order=${currentSortOrder}`;

        const statusVal = statusFilter.value;
        if (statusVal) {
            apiUrl += `&status_final=${statusVal}`;
        }
        const typeVal = typeFilter.value;
        if (typeVal) {
            apiUrl += `&download_type=${typeVal}`;
        }
        
        // Add track status filter if present
        if (trackFilter && trackFilter.value) {
            apiUrl += `&track_status=${trackFilter.value}`;
        }
        
        // Add parent task filter if viewing a specific parent's tracks
        if (currentParentTaskId) {
            apiUrl += `&parent_task_id=${currentParentTaskId}`;
        }
        
        // Add hide child tracks filter if checkbox is checked
        if (hideChildTracksCheckbox && hideChildTracksCheckbox.checked) {
            apiUrl += `&hide_child_tracks=true`;
        }

        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            renderHistory(data.entries);
            totalEntries = data.total_count;
            currentPage = Math.floor(offset / limit) + 1;
            updatePagination();
            updateSortIndicators();
            
            // Update page title if viewing tracks for a parent
            updatePageTitle();
        } catch (error) {
            console.error('Error fetching history:', error);
            if (historyTableBody) {
                historyTableBody.innerHTML = '<tr><td colspan="10">Error loading history.</td></tr>';
            }
        }
    }

    function renderHistory(entries: any[]) {
        if (!historyTableBody) return;

        historyTableBody.innerHTML = ''; // Clear existing rows
        if (!entries || entries.length === 0) {
            historyTableBody.innerHTML = '<tr><td colspan="10">No history entries found.</td></tr>';
            return;
        }

        entries.forEach(entry => {
            const row = historyTableBody.insertRow();
            
            // Add class for parent/child styling
            if (entry.parent_task_id) {
                row.classList.add('child-track-row');
            } else if (entry.download_type === 'album' || entry.download_type === 'playlist') {
                row.classList.add('parent-task-row');
            }
            
            // Item name with indentation for child tracks
            const nameCell = row.insertCell();
            if (entry.parent_task_id) {
                nameCell.innerHTML = `<span class="child-track-indent">└─ </span>${entry.item_name || 'N/A'}`;
            } else {
                nameCell.textContent = entry.item_name || 'N/A';
            }
            
            row.insertCell().textContent = entry.item_artist || 'N/A';
            
            // Type cell - show track status for child tracks
            const typeCell = row.insertCell();
            if (entry.parent_task_id && entry.track_status) {
                typeCell.textContent = entry.track_status;
                typeCell.classList.add(`track-status-${entry.track_status.toLowerCase()}`);
            } else {
                typeCell.textContent = entry.download_type ? entry.download_type.charAt(0).toUpperCase() + entry.download_type.slice(1) : 'N/A';
            }
            
            row.insertCell().textContent = entry.service_used || 'N/A';
            
            // Construct Quality display string
            const qualityCell = row.insertCell();
            let qualityDisplay = entry.quality_profile || 'N/A';
            
            // Check if convert_to exists and is not "None"
            if (entry.convert_to && entry.convert_to !== "None") {
                qualityDisplay = `${entry.convert_to.toUpperCase()}`;
                // Check if bitrate exists and is not "None"
                if (entry.bitrate && entry.bitrate !== "None") {
                    qualityDisplay += ` ${entry.bitrate}k`;
                }
                qualityDisplay += ` (${entry.quality_profile || 'Original'})`;
            } else if (entry.bitrate && entry.bitrate !== "None") { // Case where convert_to might not be set, but bitrate is (e.g. for OGG Vorbis quality settings)
                qualityDisplay = `${entry.bitrate}k (${entry.quality_profile || 'Profile'})`;
            }
            // If both are "None" or null, it will just use the quality_profile value set above
            qualityCell.textContent = qualityDisplay;

            const statusCell = row.insertCell();
            statusCell.textContent = entry.status_final || 'N/A';
            statusCell.className = `status-${entry.status_final?.toLowerCase() || 'unknown'}`;

            row.insertCell().textContent = entry.timestamp_added ? new Date(entry.timestamp_added * 1000).toLocaleString() : 'N/A';
            row.insertCell().textContent = entry.timestamp_completed ? new Date(entry.timestamp_completed * 1000).toLocaleString() : 'N/A';

            const actionsCell = row.insertCell();
            
            // Add details button
            const detailsButton = document.createElement('button');
            detailsButton.innerHTML = `<img src="/static/images/info.svg" alt="Details">`;
            detailsButton.className = 'details-btn btn-icon';
            detailsButton.title = 'Show Details';
            detailsButton.onclick = () => showDetailsModal(entry);
            actionsCell.appendChild(detailsButton);
            
            // Add view tracks button for album/playlist entries with child tracks
            if (!entry.parent_task_id && (entry.download_type === 'album' || entry.download_type === 'playlist') && 
                (entry.total_successful > 0 || entry.total_skipped > 0 || entry.total_failed > 0)) {
                const viewTracksButton = document.createElement('button');
                viewTracksButton.innerHTML = `<img src="/static/images/list.svg" alt="Tracks">`;
                viewTracksButton.className = 'tracks-btn btn-icon';
                viewTracksButton.title = 'View Tracks';
                viewTracksButton.setAttribute('data-task-id', entry.task_id);
                viewTracksButton.onclick = () => viewTracksForParent(entry.task_id);
                actionsCell.appendChild(viewTracksButton);
                
                // Add track counts display
                const trackCountsSpan = document.createElement('span');
                trackCountsSpan.className = 'track-counts';
                trackCountsSpan.title = `Successful: ${entry.total_successful || 0}, Skipped: ${entry.total_skipped || 0}, Failed: ${entry.total_failed || 0}`;
                trackCountsSpan.innerHTML = `
                    <span class="track-count success">${entry.total_successful || 0}</span> / 
                    <span class="track-count skipped">${entry.total_skipped || 0}</span> / 
                    <span class="track-count failed">${entry.total_failed || 0}</span>
                `;
                actionsCell.appendChild(trackCountsSpan);
            }

            if (entry.status_final === 'ERROR' && entry.error_message) {
                const errorSpan = document.createElement('span');
                errorSpan.textContent = ' (Show Error)';
                errorSpan.className = 'error-message-toggle';
                errorSpan.style.marginLeft = '5px';
                errorSpan.onclick = (e) => {
                    e.stopPropagation(); // Prevent click on row if any
                    let errorDetailsDiv = row.querySelector('.error-details') as HTMLElement | null;
                    if (!errorDetailsDiv) {
                        errorDetailsDiv = document.createElement('div');
                        errorDetailsDiv.className = 'error-details';
                        const newCell = row.insertCell(); // This will append to the end of the row
                        newCell.colSpan = 10; // Span across all columns
                        newCell.appendChild(errorDetailsDiv);
                    }
                    errorDetailsDiv.textContent = entry.error_message;
                    // Toggle display by directly manipulating the style of the details div
                    errorDetailsDiv.style.display = errorDetailsDiv.style.display === 'none' ? 'block' : 'none';
                };
                statusCell.appendChild(errorSpan);
            }
        });
    }

    function updatePagination() {
        if (!pageInfo || !prevButton || !nextButton) return;

        const totalPages = Math.ceil(totalEntries / limit) || 1;
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        prevButton.disabled = currentPage === 1;
        nextButton.disabled = currentPage === totalPages;
    }
    
    function updatePageTitle() {
        const titleElement = document.getElementById('history-title');
        if (!titleElement) return;
        
        if (currentParentTaskId) {
            titleElement.textContent = 'Download History - Viewing Tracks';
            
            // Add back button
            if (!document.getElementById('back-to-history')) {
                const backButton = document.createElement('button');
                backButton.id = 'back-to-history';
                backButton.className = 'btn btn-secondary';
                backButton.innerHTML = '&larr; Back to All History';
                backButton.onclick = () => {
                    currentParentTaskId = null;
                    updatePageTitle();
                    fetchHistory(1);
                };
                titleElement.parentNode?.insertBefore(backButton, titleElement);
            }
        } else {
            titleElement.textContent = 'Download History';
            
            // Remove back button if it exists
            const backButton = document.getElementById('back-to-history');
            if (backButton) {
                backButton.remove();
            }
        }
    }

    function showDetailsModal(entry: any) {
        // Create more detailed modal content with new fields
        let details = `Task ID: ${entry.task_id}\n` +
                      `Type: ${entry.download_type}\n` +
                      `Name: ${entry.item_name}\n` +
                      `Artist: ${entry.item_artist}\n` +
                      `Album: ${entry.item_album || 'N/A'}\n` +
                      `URL: ${entry.item_url || 'N/A'}\n` +
                      `Spotify ID: ${entry.spotify_id || 'N/A'}\n` +
                      `Service Used: ${entry.service_used || 'N/A'}\n` +
                      `Quality Profile (Original): ${entry.quality_profile || 'N/A'}\n` +
                      `ConvertTo: ${entry.convert_to || 'N/A'}\n` +
                      `Bitrate: ${entry.bitrate ? entry.bitrate + 'k' : 'N/A'}\n` +
                      `Status: ${entry.status_final}\n` +
                      `Error: ${entry.error_message || 'None'}\n` +
                      `Added: ${new Date(entry.timestamp_added * 1000).toLocaleString()}\n` +
                      `Completed/Ended: ${new Date(entry.timestamp_completed * 1000).toLocaleString()}\n`;
                      
        // Add track-specific details if this is a track
        if (entry.parent_task_id) {
            details += `Parent Task ID: ${entry.parent_task_id}\n` +
                       `Track Status: ${entry.track_status || 'N/A'}\n`;
        }
        
        // Add summary details if this is a parent task
        if (entry.total_successful !== null || entry.total_skipped !== null || entry.total_failed !== null) {
            details += `\nTrack Summary:\n` +
                       `Successful: ${entry.total_successful || 0}\n` +
                       `Skipped: ${entry.total_skipped || 0}\n` +
                       `Failed: ${entry.total_failed || 0}\n`;
        }
        
        details += `\nOriginal Request: ${JSON.stringify(JSON.parse(entry.original_request_json || '{}'), null, 2)}\n\n` +
                   `Last Status Object: ${JSON.stringify(JSON.parse(entry.last_status_obj_json || '{}'), null, 2)}`;
                   
        // Try to parse and display summary if available
        if (entry.summary_json) {
            try {
                const summary = JSON.parse(entry.summary_json);
                details += `\nSummary: ${JSON.stringify(summary, null, 2)}`;
            } catch (e) {
                console.error('Error parsing summary JSON:', e);
            }
        }
        
        alert(details);
    }
    
    // Function to view tracks for a parent task
    async function viewTracksForParent(taskId: string) {
        currentParentTaskId = taskId;
        currentPage = 1;
        fetchHistory(1);
    }

    document.querySelectorAll('th[data-sort]').forEach(headerCell => {
        headerCell.addEventListener('click', () => {
            const sortField = (headerCell as HTMLElement).dataset.sort;
            if (!sortField) return;

            if (currentSortBy === sortField) {
                currentSortOrder = currentSortOrder === 'ASC' ? 'DESC' : 'ASC';
            } else {
                currentSortBy = sortField;
                currentSortOrder = 'DESC';
            }
            fetchHistory(1);
        });
    });

    function updateSortIndicators() {
        document.querySelectorAll('th[data-sort]').forEach(headerCell => {
            const th = headerCell as HTMLElement;
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === currentSortBy) {
                th.classList.add(currentSortOrder === 'ASC' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    // Event listeners for pagination and filters
    prevButton?.addEventListener('click', () => fetchHistory(currentPage - 1));
    nextButton?.addEventListener('click', () => fetchHistory(currentPage + 1));
    limitSelect?.addEventListener('change', (e) => {
        limit = parseInt((e.target as HTMLSelectElement).value, 10);
        fetchHistory(1);
    });
    statusFilter?.addEventListener('change', () => fetchHistory(1));
    typeFilter?.addEventListener('change', () => fetchHistory(1));
    trackFilter?.addEventListener('change', () => fetchHistory(1));
    hideChildTracksCheckbox?.addEventListener('change', () => fetchHistory(1));

    // Initial fetch
    fetchHistory();
});