import { useState, useCallback, type ReactNode, useEffect, useRef, useMemo } from "react";
import apiClient from "../lib/api-client";
import {
    QueueContext,
    type QueueItem,
    type DownloadType,
    type QueueStatus,
    isActiveTaskStatus,
} from "./queue-context";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import type {
    CallbackObject,
    SummaryObject,
    ProcessingCallbackObject,
    TrackCallbackObject,
    AlbumCallbackObject,
    PlaylistCallbackObject,
} from "@/types/callbacks";

const isTerminalStatus = (status: QueueStatus) =>
    ["completed", "error", "cancelled", "skipped", "done"].includes(status);

function isProcessingCallback(obj: CallbackObject): obj is ProcessingCallbackObject {
    return obj && "status" in obj && obj.status === "processing";
}

function isTrackCallback(obj: any): obj is TrackCallbackObject {
    return obj && "track" in obj && "status_info" in obj;
}

function isAlbumCallback(obj: any): obj is AlbumCallbackObject {
    return obj && "album" in obj && "status_info" in obj;
}

function isPlaylistCallback(obj: any): obj is PlaylistCallbackObject {
    return obj && "playlist" in obj && "status_info" in obj;
}

export function QueueProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const pollingIntervals = useRef<Record<string, number>>({});
  const cancelledRemovalTimers = useRef<Record<string, number>>({});
  
  // SSE connection state
  const sseConnection = useRef<EventSource | null>(null);
  const isInitialized = useRef<boolean>(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const maxReconnectAttempts = 5;
  const reconnectAttempts = useRef<number>(0);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [totalTasks, setTotalTasks] = useState(0);
  const pageSize = 20; // Number of non-active tasks per page

  // Calculate active downloads count (active + queued)
  const activeCount = useMemo(() => {
    return items.filter(item => {
      // Check for status in both possible locations (nested status_info for real-time, or top-level for others)
      const actualStatus = (item.last_line?.status_info?.status as QueueStatus) || 
                           (item.last_line?.status as QueueStatus) || 
                           item.status;
      return isActiveTaskStatus(actualStatus);
    }).length;
  }, [items]);

  const stopPolling = useCallback((internalId: string) => {
    if (pollingIntervals.current[internalId]) {
      clearInterval(pollingIntervals.current[internalId]);
      delete pollingIntervals.current[internalId];
    }
  }, []);

  const scheduleCancelledTaskRemoval = useCallback((taskId: string) => {
    // Clear any existing timer for this task
    if (cancelledRemovalTimers.current[taskId]) {
      clearTimeout(cancelledRemovalTimers.current[taskId]);
    }

    // Schedule removal after 5 seconds
    cancelledRemovalTimers.current[taskId] = window.setTimeout(() => {
      setItems(prevItems => prevItems.filter(item => item.id !== taskId));
      delete cancelledRemovalTimers.current[taskId];
    }, 5000);
  }, []);

  const updateItemFromPrgs = useCallback((item: QueueItem, prgsData: any): QueueItem => {
    const updatedItem: QueueItem = { ...item };
    const { last_line, summary, status, name, artist, download_type } = prgsData;

    if (status) updatedItem.status = status as QueueStatus;
    if (summary) updatedItem.summary = summary;
    if (name) updatedItem.name = name;
    if (artist) updatedItem.artist = artist;
    if (download_type) updatedItem.type = download_type;
    
    // Preserve the last_line object for progress tracking
    if (last_line) updatedItem.last_line = last_line;

    // Check if task is cancelled and schedule removal
    const actualStatus = last_line?.status_info?.status || last_line?.status || status;
    if (actualStatus === "cancelled") {
      scheduleCancelledTaskRemoval(updatedItem.id);
    }

    if (last_line) {
        if (isProcessingCallback(last_line)) {
            updatedItem.status = "processing";
        } else if (isTrackCallback(last_line)) {
            const { status_info, track, current_track, total_tracks, parent } = last_line;
            updatedItem.currentTrackTitle = track.title;
            if (current_track) updatedItem.currentTrackNumber = current_track;
            if (total_tracks) updatedItem.totalTracks = total_tracks;
            updatedItem.status = (parent && ["done", "skipped"].includes(status_info.status)) ? "downloading" : status_info.status as QueueStatus;
            if (status_info.status === "skipped") {
                updatedItem.error = status_info.reason;
            } else if (status_info.status === "error" || status_info.status === "retrying") {
                updatedItem.error = status_info.error;
            }
            if (!parent && status_info.status === "done" && status_info.summary) updatedItem.summary = status_info.summary;
        } else if (isAlbumCallback(last_line)) {
            const { status_info, album } = last_line;
            updatedItem.status = status_info.status as QueueStatus;
            updatedItem.name = album.title;
            updatedItem.artist = album.artists.map(a => a.name).join(", ");
            updatedItem.totalTracks = album.total_tracks;
            if (status_info.status === "done") {
                if (status_info.summary) updatedItem.summary = status_info.summary;
                updatedItem.currentTrackTitle = undefined;
            } else if (status_info.status === "error") {
                updatedItem.error = status_info.error;
            }
        } else if (isPlaylistCallback(last_line)) {
            const { status_info, playlist } = last_line;
            updatedItem.status = status_info.status as QueueStatus;
            updatedItem.name = playlist.title;
            updatedItem.playlistOwner = playlist.owner.name;
            if (status_info.status === "done") {
                if (status_info.summary) updatedItem.summary = status_info.summary;
                updatedItem.currentTrackTitle = undefined;
            } else if (status_info.status === "error") {
                updatedItem.error = status_info.error;
            }
        }
    }

    return updatedItem;
  }, [scheduleCancelledTaskRemoval]);

  const startSmartPolling = useCallback(() => {
    if (sseConnection.current) return; // Already connected

    console.log("Starting SSE connection");
    
    const connectSSE = () => {
      try {
        // Create SSE connection
        const eventSource = new EventSource(`/api/prgs/stream?active_only=true`);
        sseConnection.current = eventSource;

        eventSource.onopen = () => {
          console.log("SSE connection established");
          reconnectAttempts.current = 0; // Reset reconnect attempts on successful connection
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            // Handle error events
            if (data.error) {
              console.error("SSE error event:", data.error);
              toast.error("Connection error: " + data.error);
              return;
            }

            const { tasks: updatedTasks, current_timestamp, total_tasks, task_counts } = data;
            
            // Update total tasks count - use active + queued if task_counts available
            const calculatedTotal = task_counts ? 
              (task_counts.active + task_counts.queued) : 
              (total_tasks || 0);
            setTotalTasks(calculatedTotal);

            if (updatedTasks && updatedTasks.length > 0) {
              console.log(`SSE: ${updatedTasks.length} tasks updated (${data.active_tasks} active) out of ${data.total_tasks} total`);
              
              // Create a map of updated tasks by task_id for efficient lookup
              const updatedTasksMap = new Map(updatedTasks.map((task: any) => [task.task_id, task]));
              
              setItems(prev => {
                // Update existing items with new data, and add any new active tasks
                const updatedItems = prev.map(item => {
                  const updatedTaskData = updatedTasksMap.get(item.taskId || item.id);
                  if (updatedTaskData) {
                    return updateItemFromPrgs(item, updatedTaskData);
                  }
                  return item;
                });

                // Only add new active tasks that aren't in our current items and aren't in terminal state
                const currentTaskIds = new Set(prev.map(item => item.taskId || item.id));
                const newActiveTasks = updatedTasks
                  .filter((task: any) => {
                    const isNew = !currentTaskIds.has(task.task_id);
                    const status = task.last_line?.status_info?.status || task.last_line?.status || "unknown";
                    const isActive = isActiveTaskStatus(status);
                    const isTerminal = ["completed", "error", "cancelled", "skipped", "done"].includes(status);
                    return isNew && isActive && !isTerminal;
                  })
                  .map((task: any) => {
                    const spotifyId = task.original_url?.split("/").pop() || "";
                    const baseItem: QueueItem = {
                      id: task.task_id,
                      taskId: task.task_id,
                      name: task.name || "Unknown",
                      type: task.download_type || "track",
                      spotifyId: spotifyId,
                      status: "initializing",
                      artist: task.artist,
                    };
                    return updateItemFromPrgs(baseItem, task);
                  });

                return newActiveTasks.length > 0 ? [...newActiveTasks, ...updatedItems] : updatedItems;
              });
            }
          } catch (error) {
            console.error("Failed to parse SSE message:", error);
          }
        };

        eventSource.onerror = (error) => {
          console.error("SSE connection error:", error);
          
          // Close the connection
          eventSource.close();
          sseConnection.current = null;
          
          // Attempt to reconnect with exponential backoff
          if (reconnectAttempts.current < maxReconnectAttempts) {
            reconnectAttempts.current++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current - 1), 30000); // Max 30 seconds
            
            console.log(`SSE reconnecting in ${delay}ms (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`);
            
            reconnectTimeoutRef.current = window.setTimeout(() => {
              connectSSE();
            }, delay);
          } else {
            console.error("SSE max reconnection attempts reached");
            toast.error("Connection lost. Please refresh the page.");
          }
        };

      } catch (error) {
        console.error("Failed to create SSE connection:", error);
        toast.error("Failed to establish real-time connection");
      }
    };

    connectSSE();
  }, [updateItemFromPrgs]);

  const stopSmartPolling = useCallback(() => {
    if (sseConnection.current) {
      console.log("Closing SSE connection");
      sseConnection.current.close();
      sseConnection.current = null;
    }
    
    // Clear any pending reconnection timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    // Reset reconnection attempts
    reconnectAttempts.current = 0;
  }, []);

  const loadMoreTasks = useCallback(async () => {
    if (!hasMore || isLoadingMore) return;
    
    setIsLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const response = await apiClient.get<{
        tasks: any[];
        pagination: {
          has_more: boolean;
        };
        task_counts?: {
          active: number;
          queued: number;
          retrying: number;
          completed: number;
          error: number;
          cancelled: number;
          skipped: number;
        };
      }>(`/prgs/list?page=${nextPage}&limit=${pageSize}`);
      
      const { tasks: newTasks, pagination } = response.data;
      
      if (newTasks.length > 0) {
        // Add new tasks to the end of the list (avoiding duplicates and filtering out terminal state tasks)
        setItems(prev => {
          const existingTaskIds = new Set(prev.map(item => item.taskId || item.id));
          const uniqueNewTasks = newTasks
            .filter(task => {
              // Skip if already exists
              if (existingTaskIds.has(task.task_id)) return false;
              
              // Filter out terminal state tasks
              const status = task.last_line?.status_info?.status || task.last_line?.status || "unknown";
              const isTerminal = ["completed", "error", "cancelled", "skipped", "done"].includes(status);
              return !isTerminal;
            })
            .map(task => {
              const spotifyId = task.original_url?.split("/").pop() || "";
              const baseItem: QueueItem = {
                id: task.task_id,
                taskId: task.task_id,
                name: task.name || "Unknown",
                type: task.download_type || "track",
                spotifyId: spotifyId,
                status: "initializing",
                artist: task.artist,
              };
              return updateItemFromPrgs(baseItem, task);
            });
          
          return [...prev, ...uniqueNewTasks];
        });
        
        setCurrentPage(nextPage);
      }
      
      setHasMore(pagination.has_more);
    } catch (error) {
      console.error("Failed to load more tasks:", error);
      toast.error("Failed to load more tasks");
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, isLoadingMore, currentPage, pageSize, updateItemFromPrgs]);

  const startPolling = useCallback(
    (taskId: string) => {
      // Legacy function - now just ensures SSE connection is active
      startSmartPolling();
    },
    [startSmartPolling],
  );

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        console.log("Fetching initial queue with pagination");
        const response = await apiClient.get<{
          tasks: any[];
          pagination: {
            has_more: boolean;
          };
          total_tasks: number;
          timestamp: number;
          task_counts?: {
            active: number;
            queued: number;
            retrying: number;
            completed: number;
            error: number;
            cancelled: number;
            skipped: number;
          };
        }>(`/prgs/list?page=1&limit=${pageSize}`);
        
        const { tasks, pagination, total_tasks, timestamp, task_counts } = response.data;
        
        const backendItems = tasks
          .filter((task: any) => {
            // Filter out terminal state tasks on initial fetch
            const status = task.last_line?.status_info?.status || task.last_line?.status || task.status;
            const isTerminal = ["completed", "error", "cancelled", "skipped", "done"].includes(status);
            return !isTerminal;
          })
          .map((task: any) => {
            const spotifyId = task.original_url?.split("/").pop() || "";
            const baseItem: QueueItem = {
              id: task.task_id,
              taskId: task.task_id,
              name: task.name || "Unknown",
              type: task.download_type || "track",
              spotifyId: spotifyId,
              status: "initializing",
              artist: task.artist,
            };
            return updateItemFromPrgs(baseItem, task);
          });

        setItems(backendItems);
        setHasMore(pagination.has_more);
        
        // Update total tasks count - use active + queued if task_counts available
        const calculatedTotal = task_counts ? 
          (task_counts.active + task_counts.queued) : 
          (total_tasks || 0);
        setTotalTasks(calculatedTotal);
        
        // Set initial timestamp to current time
        isInitialized.current = true;

        // Start SSE connection for real-time updates
        startSmartPolling();
      } catch (error) {
        console.error("Failed to fetch queue from backend:", error);
        toast.error("Could not load queue. Please refresh the page.");
      }
    };

    fetchQueue();
    
    // Cleanup function to stop SSE connection when component unmounts
    return () => {
      stopSmartPolling();
      // Clean up any remaining individual polling intervals (legacy cleanup)
      Object.values(pollingIntervals.current).forEach(clearInterval);
      pollingIntervals.current = {};
      // Clean up removal timers
      Object.values(cancelledRemovalTimers.current).forEach(clearTimeout);
      cancelledRemovalTimers.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addItem = useCallback(
    async (item: { name: string; type: DownloadType; spotifyId: string; artist?: string }) => {
      const internalId = uuidv4();
      const newItem: QueueItem = {
        ...item,
        id: internalId,
        status: "initializing",
      };
      setItems(prev => [newItem, ...prev]);

      try {
        const response = await apiClient.get<{ task_id: string }>(
          `/${item.type}/download/${item.spotifyId}`,
        );
        const { task_id: taskId } = response.data;

        setItems(prev =>
          prev.map(i =>
            i.id === internalId
              ? { ...i, id: taskId, taskId, status: "queued" }
              : i,
          ),
        );

        // Ensure smart polling is active for the new task
        startSmartPolling();
      } catch (error: any) {
        console.error(`Failed to start download for ${item.name}:`, error);
        toast.error(`Failed to start download for ${item.name}`);
        setItems(prev =>
          prev.map(i =>
            i.id === internalId
              ? {
                  ...i,
                  status: "error",
                  error: "Failed to start download task.",
                }
              : i,
          ),
        );
      }
    },
    [isVisible, startSmartPolling],
  );

  const removeItem = useCallback((id: string) => {
    const item = items.find(i => i.id === id);
    if (item && item.taskId) {
      stopPolling(item.taskId);
      apiClient.delete(`/prgs/delete/${item.taskId}`).catch(err => {
        console.error(`Failed to delete task ${item.taskId} from backend`, err);
        // Proceed with frontend removal anyway
      });
    }
    setItems(prev => prev.filter(i => i.id !== id));
  }, [items, stopPolling]);

  const cancelItem = useCallback(
    async (id: string) => {
      const item = items.find(i => i.id === id);
      if (!item || !item.taskId) return;

      try {
        await apiClient.post(`/prgs/cancel/${item.taskId}`);
        stopPolling(item.taskId);
        
        // Immediately update UI to show cancelled status
        setItems(prev =>
          prev.map(i =>
            i.id === id
              ? {
                  ...i,
                  status: "cancelled",
                  last_line: {
                    ...i.last_line,
                    status_info: {
                      ...i.last_line?.status_info,
                      status: "cancelled",
                      error: "Task cancelled by user",
                      timestamp: Date.now() / 1000,
                    }
                  }
                }
              : i,
          ),
        );
        
        // Schedule removal after 5 seconds
        scheduleCancelledTaskRemoval(id);
        
        toast.info(`Cancelled download: ${item.name}`);
      } catch (error) {
        console.error(`Failed to cancel task ${item.taskId}:`, error);
        toast.error(`Failed to cancel download: ${item.name}`);
      }
    },
    [items, stopPolling, scheduleCancelledTaskRemoval],
  );

  const retryItem = useCallback(
    (id: string) => {
      const item = items.find((i) => i.id === id);
      if (item && item.taskId) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === id
              ? {
                  ...i,
                  status: "pending",
                  error: undefined,
                }
              : i,
          ),
        );
        // Ensure smart polling is active for the retry
        startSmartPolling();
        toast.info(`Retrying download: ${item.name}`);
      }
    },
    [items, startSmartPolling],
  );

  const toggleVisibility = useCallback(() => {
    setIsVisible((prev) => !prev);
  }, []);

  const clearCompleted = useCallback(() => {
    setItems((prev) => prev.filter((item) => !isTerminalStatus(item.status) || item.status === "error"));
  }, []);

  const cancelAll = useCallback(async () => {
    const activeItems = items.filter((item) => {
      if (!item.taskId) return false;
      // Check for status in both possible locations (nested status_info for real-time, or top-level for others)
      const actualStatus = (item.last_line?.status_info?.status as QueueStatus) || 
                           (item.last_line?.status as QueueStatus) || 
                           item.status;
      return isActiveTaskStatus(actualStatus);
    });
    if (activeItems.length === 0) {
      toast.info("No active downloads to cancel.");
      return;
    }

    try {
      const taskIds = activeItems.map((item) => item.taskId!);
      const response = await apiClient.post("/prgs/cancel/all", { task_ids: taskIds });
      
      // Get the list of successfully cancelled task IDs from response
      const cancelledTaskIds = response.data.task_ids || taskIds; // Fallback to all if response is different

      activeItems.forEach((item) => {
        if (cancelledTaskIds.includes(item.taskId)) {
          stopPolling(item.taskId!);
        }
      });

      // Immediately update UI to show cancelled status for all cancelled tasks
      setItems((prev) =>
        prev.map((item) =>
          cancelledTaskIds.includes(item.taskId!)
            ? {
                ...item,
                status: "cancelled",
                last_line: {
                  ...item.last_line,
                  status_info: {
                    ...item.last_line?.status_info,
                    status: "cancelled",
                    error: "Task cancelled by user",
                    timestamp: Date.now() / 1000,
                  }
                }
              }
            : item,
        ),
      );

      // Schedule removal for all cancelled tasks
      activeItems.forEach((item) => {
        if (cancelledTaskIds.includes(item.taskId)) {
          scheduleCancelledTaskRemoval(item.id);
        }
      });

      toast.info(`Cancelled ${cancelledTaskIds.length} active downloads.`);
    } catch (error) {
      console.error("Failed to cancel all tasks:", error);
      toast.error("Failed to cancel all downloads.");
    }
  }, [items, stopPolling, scheduleCancelledTaskRemoval]);



  const value = {
    items,
    isVisible,
    activeCount,
    addItem,
    removeItem,
    retryItem,
    toggleVisibility,
    clearCompleted,
    cancelAll,
    cancelItem,
    // Pagination
    hasMore,
    isLoadingMore,
    loadMoreTasks,
    totalTasks,
  };

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}
