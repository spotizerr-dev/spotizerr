import { useState, useCallback, type ReactNode, useEffect, useRef } from 'react';
import apiClient from '../lib/api-client';
import { QueueContext, type QueueItem } from './queue-context';

// --- Helper Types ---
interface TaskStatus {
    status: 'downloading' | 'completed' | 'error' | 'queued';
    progress?: number;
    speed?: string;
    size?: string;
    eta?: string;
    message?: string;
}

export function QueueProvider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<QueueItem[]>([]);
    const [isVisible, setIsVisible] = useState(false);
    const pollingIntervals = useRef<Record<string, number>>({});

    // --- Core Action: Add Item ---
    const addItem = useCallback(async (item: Omit<QueueItem, 'status'>) => {
        const newItem: QueueItem = { ...item, status: 'queued' };
        setItems(prev => [...prev, newItem]);
        toggleVisibility();

        try {
            // This endpoint should initiate the download and return a task ID
            const response = await apiClient.post<{ taskId: string }>(`/download/${item.type}`, { id: item.id });
            const { taskId } = response.data;

            // Update item with taskId and start polling
            setItems(prev => prev.map(i => i.id === item.id ? { ...i, taskId, status: 'pending' } : i));
            startPolling(taskId);
        } catch (error) {
            console.error(`Failed to start download for ${item.name}:`, error);
            setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'error', error: 'Failed to start download' } : i));
        }
    }, []);

    // --- Polling Logic ---
    const startPolling = (taskId: string) => {
        if (pollingIntervals.current[taskId]) return; // Already polling

        const intervalId = window.setInterval(async () => {
            try {
                const response = await apiClient.get<TaskStatus>(`/download/status/${taskId}`);
                const statusUpdate = response.data;

                setItems(prev => prev.map(item => {
                    if (item.taskId === taskId) {
                        const updatedItem = {
                            ...item,
                            status: statusUpdate.status,
                            progress: statusUpdate.progress,
                            speed: statusUpdate.speed,
                            size: statusUpdate.size,
                            eta: statusUpdate.eta,
                            error: statusUpdate.status === 'error' ? statusUpdate.message : undefined,
                        };

                        if (statusUpdate.status === 'completed' || statusUpdate.status === 'error') {
                            stopPolling(taskId);
                        }
                        return updatedItem;
                    }
                    return item;
                }));
            } catch (error) {
                console.error(`Polling failed for task ${taskId}:`, error);
                stopPolling(taskId);
                 setItems(prev => prev.map(i => i.taskId === taskId ? { ...i, status: 'error', error: 'Connection lost' } : i));
            }
        }, 2000); // Poll every 2 seconds

        pollingIntervals.current[taskId] = intervalId;
    };

    const stopPolling = (taskId: string) => {
        clearInterval(pollingIntervals.current[taskId]);
        delete pollingIntervals.current[taskId];
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            Object.values(pollingIntervals.current).forEach(clearInterval);
        };
    }, []);

    // --- Other Actions ---
    const removeItem = useCallback((id: string) => {
        const itemToRemove = items.find(i => i.id === id);
        if (itemToRemove && itemToRemove.taskId) {
            stopPolling(itemToRemove.taskId);
            // Optionally, call an API to cancel the backend task
            // apiClient.post(`/download/cancel/${itemToRemove.taskId}`);
        }
        setItems(prev => prev.filter(item => item.id !== id));
    }, [items]);

    const clearQueue = useCallback(() => {
        Object.values(pollingIntervals.current).forEach(clearInterval);
        pollingIntervals.current = {};
        setItems([]);
         // Optionally, call an API to cancel all tasks
    }, []);

    const toggleVisibility = useCallback(() => setIsVisible(prev => !prev), []);

    const value = { items, isVisible, addItem, removeItem, clearQueue, toggleVisibility };

    return (
        <QueueContext.Provider value={value}>
            {children}
        </QueueContext.Provider>
    );
}
