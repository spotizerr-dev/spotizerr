import { useState, useCallback, type ReactNode, useEffect, useRef, useMemo } from "react";
import apiClient from "../lib/api-client";
import {
    QueueContext,
    type QueueItem,
    type DownloadType,
    type QueueStatus,
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

  // Calculate active downloads count
  const activeCount = useMemo(() => {
    return items.filter(item => !isTerminalStatus(item.status)).length;
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

  const startPolling = useCallback(
    (taskId: string) => {
        if (pollingIntervals.current[taskId]) return;

        const intervalId = window.setInterval(async () => {
            try {
                const response = await apiClient.get<any>(`/prgs/${taskId}`);
                setItems(prev =>
                    prev.map(item => {
                        if (item.taskId !== taskId) return item;
                        const updatedItem = updateItemFromPrgs(item, response.data);
                        if (isTerminalStatus(updatedItem.status as QueueStatus)) {
                            stopPolling(taskId);
                        }
                        return updatedItem;
                    }),
                );
            } catch (error) {
                console.error(`Polling failed for task ${taskId}:`, error);
                stopPolling(taskId);
                setItems(prev =>
                    prev.map(i =>
                        i.taskId === taskId
                            ? { ...i, status: "error", error: "Connection lost" }
                            : i,
                    ),
                );
            }
        }, 2000);

        pollingIntervals.current[taskId] = intervalId;
    },
    [stopPolling, updateItemFromPrgs, scheduleCancelledTaskRemoval],
  );

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const response = await apiClient.get<any[]>("/prgs/list");
        const backendItems = response.data
          .filter((task: any) => {
            // Filter out cancelled tasks on initial fetch
            const status = task.last_line?.status_info?.status || task.last_line?.status || task.status;
            return status !== "cancelled";
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

        backendItems.forEach((item: QueueItem) => {
          if (item.taskId && !isTerminalStatus(item.status)) {
            startPolling(item.taskId);
          }
        });
      } catch (error) {
        console.error("Failed to fetch queue from backend:", error);
        toast.error("Could not load queue. Please refresh the page.");
      }
    };

    fetchQueue();
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

        startPolling(taskId);
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
    [isVisible, startPolling],
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
        startPolling(item.taskId);
        toast.info(`Retrying download: ${item.name}`);
      }
    },
    [items, startPolling],
  );

  const toggleVisibility = useCallback(() => {
    setIsVisible((prev) => !prev);
  }, []);

  const clearCompleted = useCallback(() => {
    setItems((prev) => prev.filter((item) => !isTerminalStatus(item.status) || item.status === "error"));
  }, []);

  const cancelAll = useCallback(async () => {
    const activeItems = items.filter((item) => item.taskId && !isTerminalStatus(item.status));
    if (activeItems.length === 0) {
      toast.info("No active downloads to cancel.");
      return;
    }

    try {
      const taskIds = activeItems.map((item) => item.taskId!);
      await apiClient.post("/prgs/cancel/all", { task_ids: taskIds });

      activeItems.forEach((item) => stopPolling(item.id));

      setItems((prev) =>
        prev.map((item) =>
          taskIds.includes(item.taskId!)
            ? {
                ...item,
                status: "cancelled",
              }
            : item,
        ),
      );
      toast.info("Cancelled all active downloads.");
    } catch (error) {
      console.error("Failed to cancel all tasks:", error);
      toast.error("Failed to cancel all downloads.");
    }
  }, [items, stopPolling]);

  const clearAllPolls = useCallback(() => {
    Object.values(pollingIntervals.current).forEach(clearInterval);
  }, []);

  useEffect(() => {
    interface PrgsListEntry {
      task_id: string;
      name?: string;
      download_type?: string;
      status?: string;
      original_request?: { url?: string };
      last_status_obj?: {
        progress?: number;
        current_track?: number;
        total_tracks?: number;
        error?: string;
        can_retry?: boolean;
      };
      summary?: SummaryObject;
    }

    const syncActiveTasks = async () => {
      try {
        const response = await apiClient.get<PrgsListEntry[]>("/prgs/list");
        const activeTasks: QueueItem[] = response.data
          .filter((task) => {
            const status = task.status?.toLowerCase();
            return status && !isTerminalStatus(status as QueueStatus);
          })
          .map((task) => {
            const url = task.original_request?.url || "";
            const spotifyId = url.includes("spotify.com") ? url.split("/").pop() || "" : "";
            let type: DownloadType = "track";
            if (task.download_type === "album") type = "album";
            if (task.download_type === "playlist") type = "playlist";
            if (task.download_type === "artist") type = "artist";

            const queueItem: QueueItem = {
              id: task.task_id,
              taskId: task.task_id,
              name: task.name || "Unknown",
              type,
              spotifyId,
              status: (task.status?.toLowerCase() || "pending") as QueueStatus,
              progress: task.last_status_obj?.progress,
              currentTrackNumber: task.last_status_obj?.current_track,
              totalTracks: task.last_status_obj?.total_tracks,
              error: task.last_status_obj?.error,
              canRetry: task.last_status_obj?.can_retry,
              summary: task.summary,
            };
            return queueItem;
          });

        setItems((prevItems) => {
          const newItems = [...prevItems];
          activeTasks.forEach((task) => {
            const existingIndex = newItems.findIndex((item) => item.id === task.id);
            if (existingIndex === -1) {
              newItems.push(task);
            } else {
              newItems[existingIndex] = { ...newItems[existingIndex], ...task };
            }
            if (task.taskId && !isTerminalStatus(task.status)) {
              if (task.taskId && !isTerminalStatus(task.status)) {
                startPolling(task.taskId);
              }
            }
          });
          return newItems;
        });
      } catch (error) {
        console.error("Failed to sync active tasks:", error);
      }
    };

    syncActiveTasks();
    return () => {
      clearAllPolls();
      Object.values(cancelledRemovalTimers.current).forEach(clearTimeout);
    };
  }, [startPolling, clearAllPolls]);

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
  };

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}
