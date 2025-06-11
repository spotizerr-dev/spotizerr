import { createContext, useContext } from "react";

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
  | "queued";

export interface QueueItem {
  id: string; // Unique ID for the queue item (can be task_id from backend)
  name: string;
  type: DownloadType;
  spotifyId: string; // Original Spotify ID

  // --- Status and Progress ---
  status: QueueStatus;
  taskId?: string; // The backend task ID for polling
  error?: string;
  canRetry?: boolean;

  // --- Single Track Progress ---
  progress?: number; // 0-100
  speed?: string;
  size?: string;
  eta?: string;

  // --- Multi-Track (Album/Playlist) Progress ---
  currentTrackNumber?: number;
  totalTracks?: number;
  summary?: {
    successful: number;
    skipped: number;
    failed: number;
    failedTracks?: { name: string; reason: string }[];
  };
}

export interface QueueContextType {
  items: QueueItem[];
  isVisible: boolean;
  addItem: (item: { name: string; type: DownloadType; spotifyId: string }) => void;
  removeItem: (id: string) => void;
  retryItem: (id: string) => void;
  clearQueue: () => void;
  toggleVisibility: () => void;
  clearCompleted: () => void;
}

export const QueueContext = createContext<QueueContextType | undefined>(undefined);

export function useQueue() {
  const context = useContext(QueueContext);
  if (context === undefined) {
    throw new Error("useQueue must be used within a QueueProvider");
  }
  return context;
}
