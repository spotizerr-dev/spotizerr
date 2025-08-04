import { useState, useCallback, type ReactNode, useEffect, useRef, useMemo } from "react";
import { authApiClient } from "../lib/api-client";
import {
    QueueContext,
    type QueueItem,
    type DownloadType,
    getStatus,
    isActiveStatus,
    isTerminalStatus,
} from "./queue-context";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import type { CallbackObject } from "@/types/callbacks";
import { useAuth } from "@/contexts/auth-context";

export function QueueProvider({ children }: { children: ReactNode }) {
  const { isLoading, authEnabled, isAuthenticated } = useAuth();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [totalTasks, setTotalTasks] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  
  // SSE connection
  const sseConnection = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttempts = useRef<number>(0);
  const maxReconnectAttempts = 5;
  const pageSize = 20;

  // Health check for SSE connection
  const lastHeartbeat = useRef<number>(Date.now());
  const healthCheckInterval = useRef<number | null>(null);

  // Auto-removal timers for completed tasks
  const removalTimers = useRef<Record<string, number>>({});
  
  // Track pending downloads to prevent duplicates
  const pendingDownloads = useRef<Set<string>>(new Set());

  const activeCount = useMemo(() => {
    return items.filter(item => isActiveStatus(getStatus(item))).length;
  }, [items]);

  // Improved deduplication - check both id and taskId fields
  const itemExists = useCallback((taskId: string, items: QueueItem[]): boolean => {
    return items.some(item => 
      item.id === taskId || 
      item.taskId === taskId ||
      // Also check spotify ID to prevent same track being added multiple times
      (item.spotifyId && item.spotifyId === taskId)
    );
  }, []);

  // Convert SSE task data to QueueItem
  const createQueueItemFromTask = useCallback((task: any): QueueItem => {
    const spotifyId = task.original_url?.split("/").pop() || "";
    
    // Extract display info from callback
    let name = task.name || "Unknown";
    let artist = task.artist || "";
    
    // Handle different callback structures
    if (task.last_line) {
      try {
      if ("track" in task.last_line) {
        name = task.last_line.track.title || name;
        artist = task.last_line.track.artists?.[0]?.name || artist;
      } else if ("album" in task.last_line) {
        name = task.last_line.album.title || name;
        artist = task.last_line.album.artists?.map((a: any) => a.name).join(", ") || artist;
      } else if ("playlist" in task.last_line) {
        name = task.last_line.playlist.title || name;
        artist = task.last_line.playlist.owner?.name || artist;
        }
      } catch (error) {
        console.warn(`createQueueItemFromTask: Error parsing callback for task ${task.task_id}:`, error);
      }
    }

    const queueItem: QueueItem = {
      id: task.task_id,
      taskId: task.task_id,
      downloadType: task.download_type || task.type || "track",
      spotifyId,
      lastCallback: task.last_line as CallbackObject,
      name,
      artist,
      summary: task.summary,
      error: task.error,
    };

    // Debug log for status detection issues
    const status = getStatus(queueItem);
    if (status === "unknown" || !status) {
      console.warn(`createQueueItemFromTask: Created item ${task.task_id} with problematic status "${status}", type: ${queueItem.downloadType}`);
    }
    
    return queueItem;
  }, []);

  // Schedule auto-removal for completed tasks
  const scheduleRemoval = useCallback((taskId: string, delay: number = 10000) => {
    if (removalTimers.current[taskId]) {
      clearTimeout(removalTimers.current[taskId]);
    }
    
    removalTimers.current[taskId] = window.setTimeout(() => {
      setItems(prev => prev.filter(item => item.id !== taskId));
      delete removalTimers.current[taskId];
    }, delay);
  }, []);

  // SSE Health Check - detects stuck connections
  const startHealthCheck = useCallback(() => {
    if (healthCheckInterval.current) return;
    
    healthCheckInterval.current = window.setInterval(() => {
      const timeSinceLastHeartbeat = Date.now() - lastHeartbeat.current;
      const maxSilentTime = 60000; // 60 seconds without any message
      
      if (timeSinceLastHeartbeat > maxSilentTime) {
        console.warn(`SSE: No heartbeat for ${timeSinceLastHeartbeat}ms, forcing reconnection`);
        disconnectSSE();
        setTimeout(() => connectSSE(), 1000);
      }
    }, 30000); // Check every 30 seconds
  }, []);

  const stopHealthCheck = useCallback(() => {
    if (healthCheckInterval.current) {
      clearInterval(healthCheckInterval.current);
      healthCheckInterval.current = null;
    }
  }, []);

  // SSE Connection Management
  const connectSSE = useCallback(() => {
    if (sseConnection.current) return;

    try {
      // Check if we have a valid token before connecting
      const token = authApiClient.getToken();
      if (!token) {
        console.warn("SSE: No auth token available, skipping connection");
        return;
      }

      // Include token as query parameter for SSE authentication
      const sseUrl = `/api/prgs/stream?token=${encodeURIComponent(token)}`;
      const eventSource = new EventSource(sseUrl);
        sseConnection.current = eventSource;

        eventSource.onopen = () => {
        console.log("SSE connected successfully");
        reconnectAttempts.current = 0;
        lastHeartbeat.current = Date.now();
        startHealthCheck();
        // Clear any existing reconnect timeout since we're now connected
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            // Debug logging for all SSE events
            console.log("🔄 SSE Event Received:", {
              timestamp: new Date().toISOString(),
              changeType: data.change_type || "update",
              totalTasks: data.total_tasks,
              taskCounts: data.task_counts,
              tasksCount: data.tasks?.length || 0,
              taskIds: data.tasks?.map((t: any) => {
                const tempItem = createQueueItemFromTask(t);
                const status = getStatus(tempItem);
                // Special logging for playlist/album track progress
                if (t.last_line?.current_track && t.last_line?.total_tracks) {
                  return {
                    id: t.task_id,
                    status,
                    type: t.download_type,
                    track: `${t.last_line.current_track}/${t.last_line.total_tracks}`,
                    trackStatus: t.last_line.status_info?.status
                  };
                }
                return { id: t.task_id, status, type: t.download_type };
              }) || [],
              rawData: data
            });
            
            if (data.error) {
            console.error("SSE error:", data.error);
            toast.error("Connection error");
              return;
            }

          // Handle different message types from optimized backend
          const changeType = data.change_type || "update";
          const triggerReason = data.trigger_reason || "";
            
          if (changeType === "heartbeat") {
            // Heartbeat - just update counts, no task processing
            const { total_tasks, task_counts } = data;
            const calculatedTotal = task_counts ? 
              (task_counts.active + task_counts.queued) : 
              (total_tasks || 0);
            setTotalTasks(calculatedTotal);
            lastHeartbeat.current = Date.now();
            // Reduce heartbeat logging noise - only log every 10th heartbeat
            if (Math.random() < 0.1) {
              console.log("SSE: Connection active (heartbeat)");
            }
            return;
          }
          
          if (changeType === "error") {
            console.error("SSE backend error:", data.error);
            return;
          }

          // Process actual updates - also counts as heartbeat
          lastHeartbeat.current = Date.now();
          const { tasks: updatedTasks, total_tasks, task_counts } = data;
          
          // Update total count
          const calculatedTotal = task_counts ? 
            (task_counts.active + task_counts.queued) : 
            (total_tasks || 0);
          setTotalTasks(calculatedTotal);

          if (updatedTasks?.length > 0) {
            const updateType = triggerReason === "callback_update" ? "real-time callback" : "task summary";
            console.log(`SSE: Processing ${updatedTasks.length} ${updateType} updates`);
            
            setItems(prev => {
              // Create improved deduplication maps
              const existingTaskIds = new Set();
              const existingSpotifyIds = new Set();
              const existingItemsMap = new Map();
              
              prev.forEach(item => {
                if (item.id) {
                  existingTaskIds.add(item.id);
                  existingItemsMap.set(item.id, item);
                }
                if (item.taskId) {
                  existingTaskIds.add(item.taskId);
                  existingItemsMap.set(item.taskId, item);
                }
                if (item.spotifyId) existingSpotifyIds.add(item.spotifyId);
              });
              
              // Process each updated task
              const processedTaskIds = new Set<string>();
              const updatedItems: QueueItem[] = [];
              const newTasksToAdd: QueueItem[] = [];
              
              for (const task of updatedTasks) {
                const taskId = task.task_id;
                const spotifyId = task.original_url?.split("/").pop();
                
                // Skip if already processed (shouldn't happen but safety check)
                if (processedTaskIds.has(taskId)) continue;
                processedTaskIds.add(taskId);
                
                // Check if this task exists in current queue
                const existingItem = existingItemsMap.get(taskId) || 
                  Array.from(existingItemsMap.values()).find(item => 
                    item.spotifyId === spotifyId
                  );
                
                if (existingItem) {
                  // Skip SSE updates for items that are already cancelled by user action
                  const existingStatus = getStatus(existingItem);
                  if (existingStatus === "cancelled" && existingItem.error === "Cancelled by user") {
                    console.log(`SSE: Skipping update for user-cancelled task ${taskId}`);
                    continue;
                  }
                  
                  // Update existing item
                  const updatedItem = createQueueItemFromTask(task);
                  const status = getStatus(updatedItem);
                  const previousStatus = getStatus(existingItem);
                  
                  // Only log significant status changes
                  if (previousStatus !== status) {
                    console.log(`SSE: Status change ${taskId}: ${previousStatus} → ${status}`);
                  }
                  
                  // Schedule removal for terminal states
                  if (isTerminalStatus(status)) {
                    const delay = status === "cancelled" ? 5000 : 10000;
                    scheduleRemoval(existingItem.id, delay);
                    console.log(`SSE: Scheduling removal for terminal task ${taskId} (${status}) in ${delay}ms`);
                  }
                  
                  updatedItems.push(updatedItem);
                } else {
                  // This is a new task from SSE
                  const newItem = createQueueItemFromTask(task);
                  const status = getStatus(newItem);
                  
                  // Check for duplicates by spotify ID
                  if (spotifyId && existingSpotifyIds.has(spotifyId)) {
                    console.log(`SSE: Skipping duplicate by spotify ID: ${spotifyId}`);
                    continue;
                  }
                  
                  // Check if this is a pending download
                  if (pendingDownloads.current.has(spotifyId || taskId)) {
                    console.log(`SSE: Skipping pending download: ${taskId}`);
                    continue;
                  }
                  
                  // For terminal tasks from SSE, these should be tasks that just transitioned
                  // (backend now filters out already-terminal tasks)
                  if (isTerminalStatus(status)) {
                    console.log(`SSE: Adding recently completed task: ${taskId} (${status})`);
                    // Schedule immediate removal for terminal tasks
                    const delay = status === "cancelled" ? 5000 : 10000;
                    scheduleRemoval(newItem.id, delay);
                  } else if (isActiveStatus(status)) {
                    console.log(`SSE: Adding new active task: ${taskId} (${status})`);
                  } else {
                    console.warn(`SSE: Skipping task with unknown status: ${taskId} (${status})`);
                    continue;
                  }
                  
                  newTasksToAdd.push(newItem);
                }
              }
              
              // Update existing items that weren't in the update
              const finalItems = prev.map(item => {
                const updated = updatedItems.find(u => 
                  u.id === item.id || u.taskId === item.id ||
                  u.id === item.taskId || u.taskId === item.taskId
                );
                return updated || item;
              });
              
              // Add new tasks
              return newTasksToAdd.length > 0 ? [...newTasksToAdd, ...finalItems] : finalItems;
            });
          } else if (changeType === "update") {
            // Update received but no tasks - might be count updates only
            console.log("SSE: Received update with count changes only");
            }
          } catch (error) {
            console.error("Failed to parse SSE message:", error, event.data);
          }
        };

      eventSource.onerror = (error) => {
          // Use appropriate logging level - first attempt failures are common and expected
          if (reconnectAttempts.current === 0) {
            console.log("SSE initial connection failed, will retry shortly...");
          } else {
            console.warn("SSE connection error:", error);
          }
          
          // Check if this might be an auth error by testing if we still have a valid token
          const token = authApiClient.getToken();
          if (!token) {
            console.warn("SSE: Connection error and no auth token - stopping reconnection attempts");
            eventSource.close();
            sseConnection.current = null;
            stopHealthCheck();
            return;
          }
          
          eventSource.close();
          sseConnection.current = null;
          
          if (reconnectAttempts.current < maxReconnectAttempts) {
            reconnectAttempts.current++;
            // Use shorter delays for faster recovery, especially on first attempts
            const baseDelay = reconnectAttempts.current === 1 ? 100 : 1000;
            const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts.current - 1), 15000);
            
            if (reconnectAttempts.current === 1) {
              console.log("SSE: Retrying connection shortly...");
            } else {
              console.log(`SSE: Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`);
            }
            
            reconnectTimeoutRef.current = window.setTimeout(() => {
              if (reconnectAttempts.current === 1) {
                console.log("SSE: Attempting reconnection...");
              } else {
                console.log("SSE: Attempting to reconnect...");
              }
              connectSSE();
            }, delay);
          } else {
            console.error("SSE: Max reconnection attempts reached");
            toast.error("Connection lost. Please refresh the page.");
          }
        };

      } catch (error) {
        console.log("Initial SSE connection setup failed, will retry:", error);
        // Don't show toast for initial connection failures since they often recover quickly
        if (reconnectAttempts.current > 0) {
          toast.error("Failed to establish connection");
        }
      }
  }, [createQueueItemFromTask, scheduleRemoval, startHealthCheck]);

  const disconnectSSE = useCallback(() => {
    if (sseConnection.current) {
      sseConnection.current.close();
      sseConnection.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttempts.current = 0;
    stopHealthCheck();
  }, [stopHealthCheck]);

  // Load more tasks for pagination
  const loadMoreTasks = useCallback(async () => {
    if (!hasMore || isLoadingMore) return;
    
    setIsLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const response = await authApiClient.client.get(`/prgs/list?page=${nextPage}&limit=${pageSize}`);
      const { tasks: newTasks, pagination } = response.data;
      
      if (newTasks.length > 0) {
        setItems(prev => {
          const uniqueNewTasks = newTasks
            .filter((task: any) => !itemExists(task.task_id, prev))
            .filter((task: any) => {
              const tempItem = createQueueItemFromTask(task);
              const status = getStatus(tempItem);
              // Consistent filtering - exclude all terminal state tasks in pagination too
              return !isTerminalStatus(status);
            })
            .map((task: any) => createQueueItemFromTask(task));
          
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
  }, [hasMore, isLoadingMore, currentPage, createQueueItemFromTask, itemExists]);

  // Note: SSE connection state is managed through the initialize effect and restartSSE method
  // The auth context should call restartSSE() when login/logout occurs

  // Initialize queue on mount - but only after authentication is ready
  useEffect(() => {
    // Don't initialize if still loading auth state
    if (isLoading) {
      console.log("QueueProvider: Waiting for auth initialization...");
      return;
    }

    // Don't initialize if auth is enabled but user is not authenticated
    if (authEnabled && !isAuthenticated) {
      console.log("QueueProvider: Auth required but user not authenticated, skipping initialization");
      return;
    }

    const initializeQueue = async () => {
      try {
        const response = await authApiClient.client.get(`/prgs/list?page=1&limit=${pageSize}`);
        const { tasks, pagination, total_tasks, task_counts } = response.data;
        
        const queueItems = tasks
          .filter((task: any) => {
            const tempItem = createQueueItemFromTask(task);
            const status = getStatus(tempItem);
            // On refresh, exclude all terminal state tasks to start with a clean queue
            return !isTerminalStatus(status);
          })
          .map((task: any) => createQueueItemFromTask(task));

        console.log(`Queue initialized: ${queueItems.length} items (filtered out terminal state tasks)`);
        setItems(queueItems);
        setHasMore(pagination.has_more);
        
        const calculatedTotal = task_counts ? 
          (task_counts.active + task_counts.queued) : 
          (total_tasks || 0);
        setTotalTasks(calculatedTotal);
        
        // Add a small delay before connecting SSE to give server time to be ready
        setTimeout(() => {
          connectSSE();
        }, 1000);
      } catch (error) {
        console.error("Failed to initialize queue:", error);
        toast.error("Could not load queue");
      }
    };

    console.log("QueueProvider: Auth ready, initializing queue...");
    initializeQueue();
    
    return () => {
      disconnectSSE();
      stopHealthCheck();
      Object.values(removalTimers.current).forEach(clearTimeout);
      removalTimers.current = {};
    };
  }, [isLoading, authEnabled, isAuthenticated, connectSSE, disconnectSSE, createQueueItemFromTask, stopHealthCheck]);

  // Queue actions
  const addItem = useCallback(async (item: { name: string; type: DownloadType; spotifyId: string; artist?: string }) => {
    // Prevent duplicate downloads
    if (pendingDownloads.current.has(item.spotifyId)) {
      toast.info("Download already in progress");
      return;
    }
    
    // Check if item already exists in queue
    if (itemExists(item.spotifyId, items)) {
      toast.info("Item already in queue");
      return;
    }
    
    const tempId = uuidv4();
    pendingDownloads.current.add(item.spotifyId);
    
      const newItem: QueueItem = {
      id: tempId,
      downloadType: item.type,
      spotifyId: item.spotifyId,
      name: item.name,
      artist: item.artist || "",
    };
    
      setItems(prev => [newItem, ...prev]);

      try {
      const response = await authApiClient.client.get(`/${item.type}/download/${item.spotifyId}`);
        const { task_id: taskId } = response.data;

        setItems(prev =>
          prev.map(i =>
          i.id === tempId ? { ...i, id: taskId, taskId } : i
        )
      );
      
      // Remove from pending after successful API call
      pendingDownloads.current.delete(item.spotifyId);
      
      connectSSE(); // Ensure connection is active
      } catch (error: any) {
      console.error(`Failed to start download:`, error);
        toast.error(`Failed to start download for ${item.name}`);
      
      // Remove failed item and clear from pending
      setItems(prev => prev.filter(i => i.id !== tempId));
      pendingDownloads.current.delete(item.spotifyId);
    }
  }, [connectSSE, itemExists, items]);

  const removeItem = useCallback((id: string) => {
    const item = items.find(i => i.id === id);
    if (item?.taskId) {
      authApiClient.client.delete(`/prgs/delete/${item.taskId}`).catch(console.error);
    }
    setItems(prev => prev.filter(i => i.id !== id));
    
    if (removalTimers.current[id]) {
      clearTimeout(removalTimers.current[id]);
      delete removalTimers.current[id];
    }
    
    // Clear from pending downloads if it was pending
    if (item?.spotifyId) {
      pendingDownloads.current.delete(item.spotifyId);
    }
  }, [items]);

  const cancelItem = useCallback(async (id: string) => {
      const item = items.find(i => i.id === id);
    if (!item?.taskId) return;

      try {
        await authApiClient.client.post(`/prgs/cancel/${item.taskId}`);
        
        setItems(prev =>
          prev.map(i =>
          i.id === id ? { 
            ...i, 
            error: "Cancelled by user",
            lastCallback: {
              status: "cancelled",
              timestamp: Date.now() / 1000,
              type: item.downloadType,
              name: item.name,
              artist: item.artist
            } as unknown as CallbackObject
          } : i
        )
      );
      
      // Remove immediately after showing cancelled state briefly
      setTimeout(() => {
        setItems(prev => prev.filter(i => i.id !== id));
        // Clean up any existing removal timer
        if (removalTimers.current[id]) {
          clearTimeout(removalTimers.current[id]);
          delete removalTimers.current[id];
        }
      }, 500);
      
      toast.info(`Cancelled: ${item.name}`);
      } catch (error) {
      console.error("Failed to cancel task:", error);
      toast.error(`Failed to cancel: ${item.name}`);
    }
  }, [items, scheduleRemoval]);

  const cancelAll = useCallback(async () => {
    const activeItems = items.filter(item => {
      const status = getStatus(item);
      return isActiveStatus(status) && item.taskId;
    });
    
    if (activeItems.length === 0) {
      toast.info("No active downloads to cancel");
      return;
    }

    try {
      await authApiClient.client.post("/prgs/cancel/all");
      
      activeItems.forEach(item => {
        setItems(prev =>
          prev.map(i =>
            i.id === item.id ? { 
              ...i, 
              error: "Cancelled by user",
              lastCallback: {
                status: "cancelled",
                timestamp: Date.now() / 1000,
                type: item.downloadType,
                name: item.name,
                artist: item.artist
              } as unknown as CallbackObject
            } : i
          )
        );
        // Remove immediately after showing cancelled state briefly
        setTimeout(() => {
          setItems(prev => prev.filter(i => i.id !== item.id));
          // Clean up any existing removal timer
          if (removalTimers.current[item.id]) {
            clearTimeout(removalTimers.current[item.id]);
            delete removalTimers.current[item.id];
          }
        }, 500);
      });
      
      toast.info(`Cancelled ${activeItems.length} downloads`);
    } catch (error) {
      console.error("Failed to cancel all:", error);
      toast.error("Failed to cancel downloads");
    }
  }, [items, scheduleRemoval]);

  const clearCompleted = useCallback(() => {
    setItems(prev => prev.filter(item => {
      const status = getStatus(item);
      const shouldKeep = !isTerminalStatus(status) || status === "error";
      
      if (!shouldKeep && removalTimers.current[item.id]) {
        clearTimeout(removalTimers.current[item.id]);
        delete removalTimers.current[item.id];
      }
      
      return shouldKeep;
    }));
  }, []);

  const toggleVisibility = useCallback(() => {
    setIsVisible(prev => !prev);
  }, []);

  // Method to restart SSE (useful when auth state changes)
  const restartSSE = useCallback(() => {
    console.log("SSE: Restarting connection due to auth state change");
    disconnectSSE();
    setTimeout(() => connectSSE(), 1000); // Small delay to ensure clean disconnect
  }, [connectSSE, disconnectSSE]);

  const value = {
    items,
    isVisible,
    activeCount,
    totalTasks,
    hasMore,
    isLoadingMore,
    addItem,
    removeItem,
    cancelItem,
    toggleVisibility,
    clearCompleted,
    cancelAll,
    loadMoreTasks,
    restartSSE, // Expose for auth state changes
  };

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}
