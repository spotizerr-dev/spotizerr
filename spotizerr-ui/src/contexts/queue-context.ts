import { createContext, useContext } from "react";
import type { SummaryObject } from "@/types/callbacks";

export type DownloadType = "track" | "album" | "artist" | "playlist";
export type QueueStatus =
  | "initializing"
  | "pending"
  | "downloading"
  | "processing"
  | "completed"
  | "error"
  | "skipped"
  | "cancelled"
  | "done"
  | "queued"
  | "retrying"
  | "real-time"
  | "progress"
  | "track_progress";

// Active task statuses - tasks that are currently working/processing
// This matches the ACTIVE_TASK_STATES constant in the backend
export const ACTIVE_TASK_STATUSES: Set<QueueStatus> = new Set([
  "initializing",     // task is starting up
  "processing",       // task is being processed
  "downloading",      // actively downloading
  "progress",         // album/playlist progress updates
  "track_progress",   // real-time track progress
  "real-time",        // real-time download progress
  "retrying",         // task is retrying after error
]);

/**
 * Determine if a task status represents an active (working/processing) task
 */
export function isActiveTaskStatus(status: string): boolean {
  return ACTIVE_TASK_STATUSES.has(status as QueueStatus);
}

export interface QueueItem {
    id: string;
    name: string;
    type: DownloadType;
    spotifyId: string;

    // Display Info
    artist?: string;
    albumName?: string;
    playlistOwner?: string;
    currentTrackTitle?: string;

    // Status and Progress
    status: QueueStatus;
    taskId?: string;
    error?: string;
    canRetry?: boolean;
    progress?: number;
    speed?: string;
    size?: string;
    eta?: string;
    currentTrackNumber?: number;
    totalTracks?: number;
    summary?: SummaryObject;
    
    // Real-time download data
    last_line?: {
        // Direct status and error fields
        status?: string;
        error?: string;
        id?: number;
        timestamp?: number;
        
        // Album/playlist progress fields
        current_track?: number;
        total_tracks?: number;
        parent?: any; // Parent album/playlist information
        
        // Real-time progress data (when status is "real-time")
        status_info?: {
            progress?: number;
            status?: string;
            time_elapsed?: number;
            error?: string;
            timestamp?: number;
            ids?: {
                isrc?: string;
                spotify?: string;
            };
        };
        track?: any; // Contains detailed track information
    };
}

export interface QueueContextType {
  items: QueueItem[];
  isVisible: boolean;
  activeCount: number;
  addItem: (item: { name: string; type: DownloadType; spotifyId: string; artist?: string }) => void;
  removeItem: (id: string) => void;
  retryItem: (id: string) => void;
  toggleVisibility: () => void;
  clearCompleted: () => void;
  cancelAll: () => void;
  cancelItem: (id: string) => void;
  // Pagination
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMoreTasks: () => void;
  totalTasks: number;
}

export const QueueContext = createContext<QueueContextType | undefined>(undefined);

export function useQueue() {
  const context = useContext(QueueContext);
  if (context === undefined) {
    throw new Error("useQueue must be used within a QueueProvider");
  }
  return context;
}
