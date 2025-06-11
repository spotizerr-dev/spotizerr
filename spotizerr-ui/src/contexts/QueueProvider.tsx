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
    successful_tracks: number;
    skipped_tracks: number;
    failed_tracks: number;
    failed_track_details: { name: string; reason: string }[];
  };
}

const isTerminalStatus = (status: QueueStatus) => ["completed", "error", "cancelled", "skipped"].includes(status);

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
          const response = await apiClient.get<TaskStatusDTO>(`/download/status/${taskId}`);
          const statusUpdate = response.data;

          setItems((prev) =>
            prev.map((item) => {
              if (item.id === internalId) {
                const updatedItem: QueueItem = {
                  ...item,
                  status: statusUpdate.status,
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
                        failedTracks: statusUpdate.summary.failed_track_details,
                      }
                    : item.summary,
                };

                if (isTerminalStatus(statusUpdate.status)) {
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
    async (item: { name: string; type: DownloadType; spotifyId: string }) => {
      const internalId = uuidv4();
      const newItem: QueueItem = {
        ...item,
        id: internalId,
        status: "queued",
      };
      setItems((prev) => [...prev, newItem]);
      if (!isVisible) setIsVisible(true);

      try {
        const response = await apiClient.post<{ task_id: string }>(`/download`, {
          url: `https://open.spotify.com/${item.type}/${item.spotifyId}`,
        });
        const { task_id } = response.data;
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
        const response = await apiClient.get<QueueItem[]>("/download/active");
        const activeTasks = response.data;

        // Basic reconciliation
        setItems((prevItems) => {
          const newItems = [...prevItems];
          activeTasks.forEach((task) => {
            if (!newItems.some((item) => item.taskId === task.taskId)) {
              newItems.push({
                ...task,
                id: task.taskId || uuidv4(),
              });
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
            await apiClient.post(`/download/cancel/${itemToRemove.taskId}`);
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
      if (!itemToRetry || !itemToRetry.spotifyId) return;

      // Remove the old item
      setItems((prev) => prev.filter((item) => item.id !== id));

      // Add it again
      await addItem({
        name: itemToRetry.name,
        type: itemToRetry.type,
        spotifyId: itemToRetry.spotifyId,
      });
      toast.info(`Retrying download: ${itemToRetry.name}`);
    },
    [items, addItem],
  );

  const clearQueue = useCallback(async () => {
    for (const item of items) {
      if (item.taskId) {
        stopPolling(item.id);
        try {
          await apiClient.post(`/download/cancel/${item.taskId}`);
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
