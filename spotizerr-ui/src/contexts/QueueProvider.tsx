import { useState, useCallback, type ReactNode, useEffect, useRef } from "react";
import apiClient from "../lib/api-client";
import { QueueContext, type QueueItem, type DownloadType, type QueueStatus } from "./queue-context";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";

// --- Helper Types ---
// This represents the raw status object from the backend polling endpoint
interface TaskStatusDTO {
  status: QueueStatus;
  message?: string;
  can_retry?: boolean;

  // Progress indicators
  progress?: number;
  speed?: string;
  size?: string;
  eta?: string;

  // Multi-track progress
  current_track?: number;
  total_tracks?: number;
  summary?: {
    successful_tracks: string[];
    skipped_tracks: string[];
    failed_tracks: number;
    failed_track_details: { name: string; reason: string }[];
  };
}

// Task from prgs/list endpoint
interface TaskDTO {
  task_id: string;
  name?: string;
  type?: string;
  download_type?: string;
  status?: string;
  last_status_obj?: {
    status?: string;
    progress?: number;
    speed?: string;
    size?: string;
    eta?: string;
    current_track?: number;
    total_tracks?: number;
    error?: string;
    can_retry?: boolean;
  };
  original_request?: {
    url?: string;
    [key: string]: unknown;
  };
  summary?: {
    successful_tracks: string[];
    skipped_tracks: string[];
    failed_tracks: number;
    failed_track_details?: { name: string; reason: string }[];
  };
}

const isTerminalStatus = (status: QueueStatus) =>
  ["completed", "error", "cancelled", "skipped", "done"].includes(status);

export function QueueProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<QueueItem[]>(() => {
    try {
      const storedItems = localStorage.getItem("queueItems");
      return storedItems ? JSON.parse(storedItems) : [];
    } catch {
      return [];
    }
  });
  const [isVisible, setIsVisible] = useState(false);
  const pollingIntervals = useRef<Record<string, number>>({});

  // --- Persistence ---
  useEffect(() => {
    localStorage.setItem("queueItems", JSON.stringify(items));
  }, [items]);

  const stopPolling = useCallback((internalId: string) => {
    if (pollingIntervals.current[internalId]) {
      clearInterval(pollingIntervals.current[internalId]);
      delete pollingIntervals.current[internalId];
    }
  }, []);

  // --- Polling Logic ---
  const startPolling = useCallback(
    (internalId: string, taskId: string) => {
      if (pollingIntervals.current[internalId]) return;

      const intervalId = window.setInterval(async () => {
        try {
          // Use the prgs endpoint instead of download/status
          interface PrgsResponse {
            status?: string;
            summary?: TaskStatusDTO["summary"];
            last_line?: {
              status?: string;
              message?: string;
              error?: string;
              can_retry?: boolean;
              progress?: number;
              speed?: string;
              size?: string;
              eta?: string;
              current_track?: number;
              total_tracks?: number;
            };
          }

          const response = await apiClient.get<PrgsResponse>(`/prgs/${taskId}`);
          const lastStatus = response.data.last_line || {};
          const statusUpdate = {
            status: lastStatus.status || response.data.status || "pending",
            message: lastStatus.message || lastStatus.error,
            can_retry: lastStatus.can_retry,
            progress: lastStatus.progress,
            speed: lastStatus.speed,
            size: lastStatus.size,
            eta: lastStatus.eta,
            current_track: lastStatus.current_track,
            total_tracks: lastStatus.total_tracks,
            summary: response.data.summary,
          };

          setItems((prev) =>
            prev.map((item) => {
              if (item.id === internalId) {
                const updatedItem: QueueItem = {
                  ...item,
                  status: statusUpdate.status as QueueStatus,
                  progress: statusUpdate.progress,
                  speed: statusUpdate.speed,
                  size: statusUpdate.size,
                  eta: statusUpdate.eta,
                  error: statusUpdate.status === "error" ? statusUpdate.message : undefined,
                  canRetry: statusUpdate.can_retry,
                  currentTrackNumber: statusUpdate.current_track,
                  totalTracks: statusUpdate.total_tracks,
                  summary: statusUpdate.summary
                    ? {
                        successful: statusUpdate.summary.successful_tracks,
                        skipped: statusUpdate.summary.skipped_tracks,
                        failed: statusUpdate.summary.failed_tracks,
                        failedTracks: statusUpdate.summary.failed_track_details || [],
                      }
                    : item.summary,
                };

                if (isTerminalStatus(statusUpdate.status as QueueStatus)) {
                  stopPolling(internalId);
                }
                return updatedItem;
              }
              return item;
            }),
          );
        } catch (error) {
          console.error(`Polling failed for task ${taskId}:`, error);
          stopPolling(internalId);
          setItems((prev) =>
            prev.map((i) =>
              i.id === internalId
                ? {
                    ...i,
                    status: "error",
                    error: "Connection lost",
                  }
                : i,
            ),
          );
        }
      }, 2000); // Poll every 2 seconds

      pollingIntervals.current[internalId] = intervalId;
    },
    [stopPolling],
  );

  // --- Core Action: Add Item ---
  const addItem = useCallback(
    async (item: { name: string; type: DownloadType; spotifyId: string; artist?: string }) => {
      const internalId = uuidv4();
      const newItem: QueueItem = {
        ...item,
        id: internalId,
        status: "queued",
      };
      setItems((prev) => [...prev, newItem]);
      if (!isVisible) setIsVisible(true);

      try {
        let endpoint = "";

        if (item.type === "track") {
          // WORKAROUND: Use the playlist endpoint for single tracks to avoid
          // connection issues with the direct track downloader.
          const trackUrl = `https://open.spotify.com/track/${item.spotifyId}`;
          endpoint = `/playlist/download?url=${encodeURIComponent(trackUrl)}&name=${encodeURIComponent(item.name)}`;
        } else if (item.type === "album") {
          endpoint = `/album/download/${item.spotifyId}`;
        } else if (item.type === "playlist") {
          endpoint = `/playlist/download/${item.spotifyId}`;
        } else if (item.type === "artist") {
          endpoint = `/artist/download/${item.spotifyId}`;
        }

        const response = await apiClient.get<{ task_id: string }>(endpoint);
        const task_id = response.data.task_id;

        setItems((prev) =>
          prev.map((i) => (i.id === internalId ? { ...i, taskId: task_id, status: "initializing" } : i)),
        );
        startPolling(internalId, task_id);
      } catch (error) {
        console.error(`Failed to start download for ${item.name}:`, error);
        toast.error(`Failed to start download for ${item.name}`);
        setItems((prev) =>
          prev.map((i) =>
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
    [isVisible, startPolling],
  );

  const clearAllPolls = useCallback(() => {
    Object.values(pollingIntervals.current).forEach(clearInterval);
  }, []);

  // --- Load existing tasks on startup ---
  useEffect(() => {
    const syncActiveTasks = async () => {
      try {
        // Use the prgs/list endpoint instead of download/active
        const response = await apiClient.get<TaskDTO[]>("/prgs/list");

        // Map the prgs response to the expected QueueItem format
        const activeTasks = response.data
          .filter((task) => {
            // Only include non-terminal tasks
            const status = task.status?.toLowerCase();
            return status && !isTerminalStatus(status as QueueStatus);
          })
          .map((task) => {
            // Extract Spotify ID from URL if available
            const url = task.original_request?.url || "";
            const spotifyId = url.includes("spotify.com") ? url.split("/").pop() || "" : "";

            // Map download_type to UI type
            let type: DownloadType = "track";
            if (task.download_type === "album") type = "album";
            if (task.download_type === "playlist") type = "playlist";
            if (task.download_type === "artist") type = "artist";

            return {
              id: task.task_id,
              taskId: task.task_id,
              name: task.name || "Unknown",
              type,
              spotifyId,
              status: (task.status?.toLowerCase() || "pending") as QueueStatus,
              progress: task.last_status_obj?.progress,
              speed: task.last_status_obj?.speed,
              size: task.last_status_obj?.size,
              eta: task.last_status_obj?.eta,
              currentTrackNumber: task.last_status_obj?.current_track,
              totalTracks: task.last_status_obj?.total_tracks,
              error: task.last_status_obj?.error,
              canRetry: task.last_status_obj?.can_retry,
              summary: task.summary
                ? {
                    successful: task.summary.successful_tracks,
                    skipped: task.summary.skipped_tracks,
                    failed: task.summary.failed_tracks,
                    failedTracks: task.summary.failed_track_details || [],
                  }
                : undefined,
            };
          });

        // Basic reconciliation
        setItems((prevItems) => {
          const newItems = [...prevItems];
          activeTasks.forEach((task) => {
            if (!newItems.some((item) => item.taskId === task.taskId)) {
              newItems.push(task);
            }
          });
          return newItems;
        });

        activeTasks.forEach((item) => {
          if (item.id && item.taskId && !isTerminalStatus(item.status)) {
            startPolling(item.id, item.taskId);
          }
        });
      } catch (error) {
        console.error("Failed to sync active tasks:", error);
      }
    };
    syncActiveTasks();

    // restart polling for any non-terminal items from localStorage
    items.forEach((item) => {
      if (item.id && item.taskId && !isTerminalStatus(item.status)) {
        startPolling(item.id, item.taskId);
      }
    });

    return clearAllPolls;
    // This effect should only run once on mount to initialize the queue.
    // We are intentionally omitting 'items' as a dependency to prevent re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearAllPolls, startPolling]);

  // --- Other Actions ---
  const removeItem = useCallback(
    async (id: string) => {
      const itemToRemove = items.find((i) => i.id === id);
      if (itemToRemove) {
        stopPolling(itemToRemove.id);
        if (itemToRemove.taskId) {
          try {
            // Use the prgs endpoint to cancel tasks
            await apiClient.post(`/prgs/cancel/${itemToRemove.taskId}`);
            toast.success(`Cancelled download: ${itemToRemove.name}`);
          } catch {
            toast.error(`Failed to cancel download: ${itemToRemove.name}`);
          }
        }
      }
      setItems((prev) => prev.filter((item) => item.id !== id));
    },
    [items, stopPolling],
  );

  const retryItem = useCallback(
    async (id: string) => {
      const itemToRetry = items.find((i) => i.id === id);
      if (!itemToRetry || !itemToRetry.taskId) return;

      try {
        // Use the prgs/retry endpoint
        await apiClient.post(`/prgs/retry/${itemToRetry.taskId}`);
        toast.info(`Retrying download: ${itemToRetry.name}`);

        // Update the item status in the UI
        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: "initializing",
                  error: undefined,
                }
              : item,
          ),
        );

        // Start polling again
        startPolling(id, itemToRetry.taskId);
      } catch (error) {
        console.error(`Failed to retry download for ${itemToRetry.name}:`, error);
        toast.error(`Failed to retry download: ${itemToRetry.name}`);
      }
    },
    [items, startPolling],
  );

  const clearQueue = useCallback(async () => {
    for (const item of items) {
      if (item.taskId) {
        stopPolling(item.id);
        try {
          // Use the prgs endpoint to cancel tasks
          await apiClient.post(`/prgs/cancel/${item.taskId}`);
        } catch (err) {
          console.error(`Failed to cancel task ${item.taskId}`, err);
        }
      }
    }
    setItems([]);
    toast.info("Queue cleared.");
  }, [items, stopPolling]);

  const clearCompleted = useCallback(() => {
    setItems((prev) => prev.filter((item) => !isTerminalStatus(item.status)));
  }, []);

  const toggleVisibility = useCallback(() => setIsVisible((prev) => !prev), []);

  const value = {
    items,
    isVisible,
    addItem,
    removeItem,
    retryItem,
    clearQueue,
    toggleVisibility,
    clearCompleted,
  };

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}
