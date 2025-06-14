import { useState, useCallback, type ReactNode, useEffect, useRef } from "react";
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

  useEffect(() => {
    localStorage.setItem("queueItems", JSON.stringify(items));
  }, [items]);

  // Effect to resume polling for active tasks on component mount
  useEffect(() => {
    if (items.length > 0) {
      items.forEach((item) => {
        // If a task has an ID and is not in a finished state, restart polling.
        if (item.taskId && !isTerminalStatus(item.status)) {
          console.log(`Resuming polling for ${item.name} (Task ID: ${item.taskId})`);
          startPolling(item.id, item.taskId);
        }
      });
    }
    // This effect should only run once on mount to avoid re-triggering polling unnecessarily.
    // We are disabling the dependency warning because we intentionally want to use the initial `items` state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopPolling = useCallback((internalId: string) => {
    if (pollingIntervals.current[internalId]) {
      clearInterval(pollingIntervals.current[internalId]);
      delete pollingIntervals.current[internalId];
    }
  }, []);

  const startPolling = useCallback(
    (internalId: string, taskId: string) => {
        if (pollingIntervals.current[internalId]) return;

        const intervalId = window.setInterval(async () => {
            try {
                interface PrgsResponse {
                    status?: string;
                    summary?: SummaryObject;
                    last_line?: CallbackObject;
                }

                const response = await apiClient.get<PrgsResponse>(`/prgs/${taskId}`);
                const { last_line, summary, status } = response.data;

                setItems(prev =>
                    prev.map(item => {
                        if (item.id !== internalId) return item;

                        const updatedItem: QueueItem = { ...item };

                        if (status) {
                            updatedItem.status = status as QueueStatus;
                        }

                        if (summary) {
                            updatedItem.summary = summary;
                        }

                        if (last_line) {
                            if (isProcessingCallback(last_line)) {
                                updatedItem.status = "processing";
                            } else if (isTrackCallback(last_line)) {
                                const { status_info, track, current_track, total_tracks, parent } = last_line;

                                updatedItem.currentTrackTitle = track.title;
                                if (current_track) updatedItem.currentTrackNumber = current_track;
                                if (total_tracks) updatedItem.totalTracks = total_tracks;

                                // A child track being "done" doesn't mean the whole download is done.
                                // The final "done" status comes from the parent (album/playlist) callback.
                                if (parent && status_info.status === "done") {
                                    updatedItem.status = "downloading"; // Or keep current status if not 'error'
                                } else {
                                    updatedItem.status = status_info.status as QueueStatus;
                                }

                                if (status_info.status === "error" || status_info.status === "retrying") {
                                    updatedItem.error = status_info.error;
                                }

                                // For single tracks, the "done" status is final.
                                if (!parent && status_info.status === "done") {
                                    if (status_info.summary) updatedItem.summary = status_info.summary;
                                }
                            } else if (isAlbumCallback(last_line)) {
                                const { status_info, album } = last_line;
                                updatedItem.status = status_info.status as QueueStatus;
                                updatedItem.name = album.title;
                                updatedItem.artist = album.artists.map(a => a.name).join(", ");
                                if (status_info.status === "done" && status_info.summary) {
                                    updatedItem.summary = status_info.summary;
                                }
                                if (status_info.status === "error") {
                                    updatedItem.error = status_info.error;
                                }
                            } else if (isPlaylistCallback(last_line)) {
                                const { status_info, playlist } = last_line;
                                updatedItem.status = status_info.status as QueueStatus;
                                updatedItem.name = playlist.title;
                                updatedItem.playlistOwner = playlist.owner.name;
                                if (status_info.status === "done" && status_info.summary) {
                                    updatedItem.summary = status_info.summary;
                                }
                                if (status_info.status === "error") {
                                    updatedItem.error = status_info.error;
                                }
                            }
                        }

                        if (isTerminalStatus(updatedItem.status as QueueStatus)) {
                            stopPolling(internalId);
                        }

                        return updatedItem;
                    }),
                );
            } catch (error) {
                console.error(`Polling failed for task ${taskId}:`, error);
                stopPolling(internalId);
                setItems(prev =>
                    prev.map(i =>
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
        }, 2000);

        pollingIntervals.current[internalId] = intervalId;
    },
    [stopPolling],
  );

  useEffect(() => {
    items.forEach((item) => {
      if (item.taskId && !isTerminalStatus(item.status)) {
        startPolling(item.id, item.taskId);
      }
    });
    // We only want to run this on mount, so we disable the exhaustive-deps warning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          endpoint = `/track/download/${item.spotifyId}`;
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

  const removeItem = useCallback(
    (id: string) => {
      const item = items.find((i) => i.id === id);
      if (item?.taskId) {
        stopPolling(item.id);
      }
      setItems((prev) => prev.filter((item) => item.id !== id));
    },
    [items, stopPolling],
  );

  const cancelItem = useCallback(
    async (id: string) => {
      const item = items.find((i) => i.id === id);
      if (!item || !item.taskId) return;

      try {
        await apiClient.post(`/prgs/cancel/${item.taskId}`);
        stopPolling(id);
        setItems((prev) =>
          prev.map((i) =>
            i.id === id
              ? {
                  ...i,
                  status: "cancelled",
                }
              : i,
          ),
        );
        toast.info(`Cancelled download: ${item.name}`);
      } catch (error) {
        console.error(`Failed to cancel task ${item.taskId}:`, error);
        toast.error(`Failed to cancel download: ${item.name}`);
      }
    },
    [items, stopPolling],
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
        startPolling(id, item.taskId);
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
      await apiClient.post("/prgs/cancel/many", { task_ids: taskIds });

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
            startPolling(task.id, task.taskId!);
          });
          return newItems;
        });
      } catch (error) {
        console.error("Failed to sync active tasks:", error);
      }
    };

    syncActiveTasks();
    return () => clearAllPolls();
  }, [startPolling, clearAllPolls]);

  const value = {
    items,
    isVisible,
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
