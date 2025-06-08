import { createContext, useContext } from 'react';

export interface QueueItem {
  id: string; // This is the Spotify ID
  type: 'track' | 'album' | 'artist' | 'playlist';
  name: string;
  // --- Real-time progress fields ---
  status: 'pending' | 'downloading' | 'completed' | 'error' | 'queued';
  taskId?: string; // The backend task ID for polling
  progress?: number;
  speed?: string;
  size?: string;
  eta?: string;
  error?: string;
}

export interface QueueContextType {
  items: QueueItem[];
  isVisible: boolean;
  addItem: (item: Omit<QueueItem, 'status'>) => void;
  removeItem: (id: string) => void;
  clearQueue: () => void;
  toggleVisibility: () => void;
}

export const QueueContext = createContext<QueueContextType | undefined>(undefined);

export function useQueue() {
  const context = useContext(QueueContext);
  if (context === undefined) {
    throw new Error('useQueue must be used within a QueueProvider');
  }
  return context;
}
