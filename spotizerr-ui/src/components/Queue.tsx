import { useContext, useState, useRef, useEffect } from "react";
import {
  FaTimes,
  FaSync,
  FaCheckCircle,
  FaExclamationCircle,
  FaHourglassHalf,
  FaMusic,
  FaCompactDisc,
} from "react-icons/fa";
import { QueueContext, type QueueItem, type QueueStatus } from "@/contexts/queue-context";

const isTerminalStatus = (status: QueueStatus) =>
  ["completed", "error", "cancelled", "skipped", "done"].includes(status);

const statusStyles: Record<
  QueueStatus,
  { icon: React.ReactNode; color: string; bgColor: string; borderColor: string; name: string }
> = {
  queued: {
    icon: <FaHourglassHalf className="icon-muted" />,
    color: "text-content-muted dark:text-content-muted-dark",
    bgColor: "bg-gradient-to-r from-surface-muted to-surface-accent dark:from-surface-muted-dark dark:to-surface-accent-dark",
    borderColor: "border-border dark:border-border-dark",
    name: "Queued",
  },
  initializing: {
    icon: <FaSync className="animate-spin icon-accent" />,
    color: "text-info",
    bgColor: "bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/30",
    borderColor: "border-info/30 dark:border-info/40",
    name: "Initializing",
  },
  downloading: {
    icon: <FaSync className="animate-spin icon-accent" />,
    color: "text-info",
    bgColor: "bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/30",
    borderColor: "border-info/30 dark:border-info/40",
    name: "Downloading",
  },
  processing: {
    icon: <FaSync className="animate-spin icon-warning" />,
    color: "text-processing",
    bgColor: "bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/30",
    borderColor: "border-processing/30 dark:border-processing/40",
    name: "Processing",
  },
  retrying: {
    icon: <FaSync className="animate-spin icon-warning" />,
    color: "text-warning",
    bgColor: "bg-gradient-to-r from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/30",
    borderColor: "border-warning/30 dark:border-warning/40",
    name: "Retrying",
  },
  completed: {
    icon: <FaCheckCircle className="icon-success" />,
    color: "text-success",
    bgColor: "bg-gradient-to-r from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/30",
    borderColor: "border-success/30 dark:border-success/40",
    name: "Completed",
  },
  done: {
    icon: <FaCheckCircle className="icon-success" />,
    color: "text-success",
    bgColor: "bg-gradient-to-r from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/30",
    borderColor: "border-success/30 dark:border-success/40",
    name: "Done",
  },
  error: {
    icon: <FaExclamationCircle className="icon-error" />,
    color: "text-error",
    bgColor: "bg-gradient-to-r from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/30",
    borderColor: "border-error/30 dark:border-error/40",
    name: "Error",
  },
  cancelled: {
    icon: <FaTimes className="icon-warning" />,
    color: "text-warning",
    bgColor: "bg-gradient-to-r from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/30",
    borderColor: "border-warning/30 dark:border-warning/40",
    name: "Cancelled",
  },
  skipped: {
    icon: <FaTimes className="icon-muted" />,
    color: "text-content-muted dark:text-content-muted-dark",
    bgColor: "bg-gradient-to-r from-surface-muted to-surface-accent dark:from-surface-muted-dark dark:to-surface-accent-dark",
    borderColor: "border-border dark:border-border-dark",
    name: "Skipped",
  },
  pending: {
    icon: <FaHourglassHalf className="icon-muted" />,
    color: "text-content-muted dark:text-content-muted-dark",
    bgColor: "bg-gradient-to-r from-surface-muted to-surface-accent dark:from-surface-muted-dark dark:to-surface-accent-dark",
    borderColor: "border-border dark:border-border-dark",
    name: "Pending",
  },
  "real-time": {
    icon: <FaSync className="animate-spin icon-accent" />,
    color: "text-info",
    bgColor: "bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/30",
    borderColor: "border-info/30 dark:border-info/40",
    name: "Real-time Download",
  },
};

// Circular Progress Component
const CircularProgress = ({ 
  progress, 
  isCompleted = false, 
  isRealProgress = false,
  size = 60, 
  strokeWidth = 6,
  className = ""
}: { 
  progress: number;
  isCompleted?: boolean;
  isRealProgress?: boolean;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) => {
  // Apply a logarithmic curve to make progress slower near the end - ONLY for fake progress
  const getAdjustedProgress = (rawProgress: number) => {
    if (isCompleted) return 100;
    if (rawProgress <= 0) return 0;
    
    // If this is real progress data, show it as-is without any artificial manipulation
    if (isRealProgress) {
      return Math.min(Math.max(rawProgress, 0), 100);
    }
    
    // Only apply logarithmic curve for fake/simulated progress
    // Use a logarithmic curve that slows down significantly near 100%
    // This creates the effect of filling more slowly as it approaches completion
    const normalized = Math.min(Math.max(rawProgress, 0), 100) / 100;
    
    // Apply easing function that slows down dramatically near the end
    const eased = 1 - Math.pow(1 - normalized, 3); // Cubic ease-out
    const logarithmic = Math.log(normalized * 9 + 1) / Math.log(10); // Logarithmic scaling
    
    // Combine both for a very slow approach to 100%
    const combined = (eased * 0.7 + logarithmic * 0.3) * 95; // Cap at 95% during download
    
    // Ensure minimum visibility for any progress > 0
    const minVisible = rawProgress > 0 ? Math.max(combined, 8) : 0;
    
    return Math.min(minVisible, 95); // Never quite reach 100% during download
  };

  const adjustedProgress = getAdjustedProgress(progress);
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (adjustedProgress / 100) * circumference;

  return (
    <div className={`relative inline-flex ${className}`}>
      <svg
        width={size}
        height={size}
        className="transform -rotate-90"
      >
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-border dark:text-border-dark opacity-60"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          className={`transition-all duration-500 ease-out ${
            isCompleted 
              ? "text-success" 
              : "text-info"
          }`}
          style={{
            strokeDashoffset: isCompleted ? 0 : strokeDashoffset,
          }}
        />
      </svg>
      {/* Center content */}
      <div className="absolute inset-0 flex items-center justify-center">
        {isCompleted ? (
          <FaCheckCircle className="text-success text-lg" />
        ) : (
          <span className="text-xs font-semibold text-content-primary dark:text-content-primary-dark">
            {Math.round(progress)}%
          </span>
        )}
      </div>
    </div>
  );
};

const QueueItemCard = ({ item }: { item: QueueItem }) => {
  const { removeItem, retryItem, cancelItem } = useContext(QueueContext) || {};
  
  // Extract the actual status - prioritize status_info.status, then last_line.status, then item.status
  const actualStatus = (item.last_line?.status_info?.status as QueueStatus) || 
                       (item.last_line?.status as QueueStatus) || 
                       item.status;
  const statusInfo = statusStyles[actualStatus] || statusStyles.queued;
  const isTerminal = isTerminalStatus(actualStatus);

  const getProgressText = () => {
    const { type, progress, totalTracks, summary, last_line } = item;

    // Handle real-time downloads
    if (actualStatus === "real-time") {
      const realTimeProgress = last_line?.status_info?.progress;
      if (type === "track" && realTimeProgress !== undefined) {
        return `${realTimeProgress.toFixed(0)}%`;
      }
      return null;
    }

    if (actualStatus === "downloading" || actualStatus === "processing") {
      if (type === "track") {
        return progress !== undefined ? `${progress.toFixed(0)}%` : null;
      }
      // For albums/playlists, detailed progress is in the main body
      return null;
    }

    if ((actualStatus === "completed" || actualStatus === "done") && summary) {
      if (type === "track") {
        // For single tracks, don't show redundant text since status badge already shows "Done"
        return null;
      }
      return `${summary.total_successful}/${totalTracks} tracks`;
    }

    return null;
  };

  const progressText = getProgressText();

  return (
    <div className={`p-4 md:p-4 rounded-xl border-2 shadow-lg mb-3 transition-all duration-300 hover:shadow-xl md:hover:scale-[1.02] ${statusInfo.bgColor} ${statusInfo.borderColor}`}>
      {/* Mobile-first layout: stack status and actions on mobile, inline on desktop */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-0">
        <div className="flex items-center gap-3 md:gap-4 min-w-0 flex-1">
          <div className={`text-2xl md:text-2xl ${statusInfo.color} bg-white/80 dark:bg-surface-dark/80 p-2 md:p-2 rounded-full shadow-sm flex-shrink-0`}>
            {statusInfo.icon}
          </div>
          <div className="flex-grow min-w-0">
            {item.type === "track" && (
              <>
                <div className="flex items-center gap-2">
                  <FaMusic className="icon-muted text-sm flex-shrink-0" />
                  <p className="font-bold text-base md:text-sm text-content-primary dark:text-content-primary-dark truncate" title={item.name}>
                    {item.name}
                  </p>
                </div>
                <p className="text-sm md:text-sm text-content-secondary dark:text-content-secondary-dark truncate" title={item.artist}>
                  {item.artist}
                </p>
                {item.albumName && (
                  <p className="text-xs md:text-xs text-content-muted dark:text-content-muted-dark truncate" title={item.albumName}>
                    {item.albumName}
                  </p>
                )}
              </>
            )}
            {item.type === "album" && (
              <>
                <div className="flex items-center gap-2">
                  <FaCompactDisc className="icon-muted text-sm flex-shrink-0" />
                  <p className="font-bold text-base md:text-sm text-content-primary dark:text-content-primary-dark truncate" title={item.name}>
                    {item.name}
                  </p>
                </div>
                <p className="text-sm md:text-sm text-content-secondary dark:text-content-secondary-dark truncate" title={item.artist}>
                  {item.artist}
                </p>
                {item.currentTrackTitle && (
                  <p className="text-xs md:text-xs text-content-muted dark:text-content-muted-dark truncate" title={item.currentTrackTitle}>
                    {item.currentTrackNumber}/{item.totalTracks}: {item.currentTrackTitle}
                  </p>
                )}
              </>
            )}
            {item.type === "playlist" && (
              <>
                <div className="flex items-center gap-2">
                  <FaMusic className="icon-muted text-sm flex-shrink-0" />
                  <p className="font-bold text-base md:text-sm text-content-primary dark:text-content-primary-dark truncate" title={item.name}>
                    {item.name}
                  </p>
                </div>
                <p className="text-sm md:text-sm text-content-secondary dark:text-content-secondary-dark truncate" title={item.playlistOwner}>
                  {item.playlistOwner}
                </p>
                {item.currentTrackTitle && (
                  <p className="text-xs md:text-xs text-content-muted dark:text-content-muted-dark truncate" title={item.currentTrackTitle}>
                    {item.currentTrackNumber}/{item.totalTracks}: {item.currentTrackTitle}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        
        {/* Status and actions - stacked on mobile, inline on desktop */}
        <div className="flex items-center justify-between md:justify-end gap-3 md:gap-3 md:ml-4">
          <div className="flex-1 md:flex-none md:text-right">
            <div className={`inline-flex items-center px-3 py-1 md:px-3 md:py-1 rounded-full text-sm md:text-xs font-semibold ${statusInfo.color} bg-white/60 dark:bg-surface-dark/60 shadow-sm`}>
              {statusInfo.name}
            </div>
            {(() => {
              // Only show text progress if we're not showing circular progress
              const hasCircularProgress = item.type === "track" && !isTerminal && 
                (item.last_line?.status_info?.progress !== undefined || item.progress !== undefined);
              
              return !hasCircularProgress && progressText && (
                <p className="text-sm md:text-xs text-content-muted dark:text-content-muted-dark mt-1">{progressText}</p>
              );
            })()}
          </div>
          
          {/* Add circular progress for downloading tracks */}
          {(() => {
            // Calculate progress based on item type and data availability
            let currentProgress: number | undefined;
            let isRealProgress = false;
            
            if (item.type === "track") {
              // For tracks, use direct progress
              const realTimeProgress = item.last_line?.status_info?.progress;
              const fallbackProgress = item.progress;
              currentProgress = realTimeProgress ?? fallbackProgress;
              isRealProgress = realTimeProgress !== undefined;
            } else if ((item.type === "album" || item.type === "playlist") && item.last_line?.status_info?.progress !== undefined) {
              // For albums/playlists with real-time data, calculate overall progress
              const trackProgress = item.last_line.status_info.progress;
              const currentTrack = item.last_line.current_track || 1;
              const totalTracks = item.last_line.total_tracks || item.totalTracks || 1;
              
              // Formula: ((completed_tracks + current_track_progress/100) / total_tracks) * 100
              const completedTracks = currentTrack - 1; // current_track is 1-indexed
              currentProgress = ((completedTracks + (trackProgress / 100)) / totalTracks) * 100;
              isRealProgress = true;
            } else if ((item.type === "album" || item.type === "playlist") && item.progress !== undefined) {
              // Fallback for albums/playlists without real-time data
              currentProgress = item.progress;
              isRealProgress = false;
            }
            
            // Show circular progress for items that are not in terminal state 
            const shouldShowProgress = !isTerminal && currentProgress !== undefined;
            
            return shouldShowProgress && (
              <div className="flex-shrink-0">
                <CircularProgress 
                  progress={currentProgress!} 
                  isCompleted={false}
                  isRealProgress={isRealProgress}
                  size={44}
                  strokeWidth={4}
                  className="md:mr-2"
                />
              </div>
            );
          })()}
          
          {/* Show completed circular progress for completed tracks */}
          {(actualStatus === "completed" || actualStatus === "done") && 
           item.type === "track" && (
            <div className="flex-shrink-0">
              <CircularProgress 
                progress={100} 
                isCompleted={true}
                isRealProgress={true}
                size={44}
                strokeWidth={4}
                className="md:mr-2"
              />
            </div>
          )}
          
          <div className="flex gap-2 md:gap-1 flex-shrink-0">
            {isTerminal ? (
              <button
                onClick={() => removeItem?.(item.id)}
                className="p-3 md:p-2 rounded-full bg-white/60 dark:bg-surface-dark/60 text-content-muted dark:text-content-muted-dark hover:text-error hover:bg-error/10 transition-all duration-200 shadow-sm min-h-[44px] md:min-h-auto flex items-center justify-center"
                aria-label="Remove"
              >
                <FaTimes className="text-base md:text-sm" />
              </button>
            ) : (
              <button
                onClick={() => cancelItem?.(item.id)}
                className="p-3 md:p-2 rounded-full bg-white/60 dark:bg-surface-dark/60 text-content-muted dark:text-content-muted-dark hover:text-warning hover:bg-warning/10 transition-all duration-200 shadow-sm min-h-[44px] md:min-h-auto flex items-center justify-center"
                aria-label="Cancel"
              >
                <FaTimes className="text-base md:text-sm" />
              </button>
            )}
            {item.canRetry && (
              <button
                onClick={() => retryItem?.(item.id)}
                className="p-3 md:p-2 rounded-full bg-white/60 dark:bg-surface-dark/60 text-content-muted dark:text-content-muted-dark hover:text-info hover:bg-info/10 transition-all duration-200 shadow-sm min-h-[44px] md:min-h-auto flex items-center justify-center"
                aria-label="Retry"
              >
                <FaSync className="text-base md:text-sm" />
              </button>
            )}
          </div>
        </div>
      </div>
      {(actualStatus === "error" || actualStatus === "retrying" || actualStatus === "cancelled") && (item.error || item.last_line?.error || item.last_line?.status_info?.error) && (
        <div className="mt-3 p-3 md:p-2 bg-error/10 border border-error/20 rounded-lg">
          <p className="text-sm md:text-xs text-error font-medium break-words">
            {actualStatus === "cancelled" ? "Cancelled: " : "Error: "}
            {item.last_line?.status_info?.error || item.last_line?.error || item.error}
          </p>
        </div>
      )}
      {isTerminal && item.summary && (item.summary.total_failed > 0 || item.summary.total_skipped > 0) && (
        <div className="mt-3 p-3 md:p-2 bg-surface/50 dark:bg-surface-dark/50 rounded-lg">
          <div className="flex flex-wrap gap-3 md:gap-4 text-sm md:text-xs">
            {item.summary.total_failed > 0 && (
              <span className="flex items-center gap-2 md:gap-1">
                <div className="w-3 h-3 md:w-2 md:h-2 bg-error rounded-full flex-shrink-0"></div>
                <span className="text-error font-medium">{item.summary.total_failed} failed</span>
              </span>
            )}
            {item.summary.total_skipped > 0 && (
              <span className="flex items-center gap-2 md:gap-1">
                <div className="w-3 h-3 md:w-2 md:h-2 bg-warning rounded-full flex-shrink-0"></div>
                <span className="text-warning font-medium">{item.summary.total_skipped} skipped</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const Queue = () => {
  const context = useContext(QueueContext);
  const [startY, setStartY] = useState<number | null>(null);
  const [currentY, setCurrentY] = useState<number | null>(null);
  const queueRef = useRef<HTMLDivElement>(null);

  if (!context) return null;
  const { items, isVisible, toggleVisibility, cancelAll, clearCompleted } = context;

  if (!isVisible) return null;

  const hasActive = items.some((item) => !isTerminalStatus(item.status));
  const hasFinished = items.some((item) => isTerminalStatus(item.status));

  // Handle mobile swipe-to-dismiss
  const handleTouchStart = (e: React.TouchEvent) => {
    setStartY(e.touches[0].clientY);
    setCurrentY(e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY === null) return;
    setCurrentY(e.touches[0].clientY);
    
    const deltaY = e.touches[0].clientY - startY;
    
    // Only allow downward swipes to dismiss
    if (deltaY > 0) {
      if (queueRef.current) {
        queueRef.current.style.transform = `translateY(${Math.min(deltaY, 100)}px)`;
        queueRef.current.style.opacity = `${Math.max(0.3, 1 - deltaY / 200)}`;
      }
    }
  };

  const handleTouchEnd = () => {
    if (startY === null || currentY === null) return;
    
    const deltaY = currentY - startY;
    
    if (queueRef.current) {
      queueRef.current.style.transform = '';
      queueRef.current.style.opacity = '';
    }
    
    // Dismiss if swiped down more than 50px
    if (deltaY > 50) {
      toggleVisibility();
    }
    
    setStartY(null);
    setCurrentY(null);
  };

  return (
    <>
      {/* Mobile backdrop overlay */}
      <div 
        className="fixed inset-0 bg-black/50 z-40 md:hidden"
        onClick={toggleVisibility}
      />
      
      <div 
        ref={queueRef}
        className="fixed inset-x-0 bottom-0 md:bottom-4 md:right-4 md:inset-x-auto w-full md:max-w-md bg-surface dark:bg-surface-dark md:rounded-xl shadow-2xl border-t md:border border-border dark:border-border-dark z-50 backdrop-blur-sm md:rounded-b-xl transition-transform transition-opacity"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <header className="flex items-center justify-between p-4 md:p-4 border-b border-border dark:border-border-dark bg-gradient-to-r from-surface to-surface-secondary dark:from-surface-dark dark:to-surface-secondary-dark md:rounded-t-xl">
          {/* Add drag indicator for mobile */}
          <div className="md:hidden absolute top-2 left-1/2 transform -translate-x-1/2 w-12 h-1 bg-content-muted dark:bg-content-muted-dark rounded-full opacity-50"></div>
          <h2 className="text-lg md:text-lg font-bold text-content-primary dark:text-content-primary-dark">
            Download Queue ({items.length})
          </h2>
          <div className="flex gap-1 md:gap-2">
            <button
              onClick={cancelAll}
              className="text-xs md:text-sm text-content-muted dark:text-content-muted-dark hover:text-warning transition-colors px-3 py-2 md:px-2 md:py-1 rounded-md hover:bg-warning/10 min-h-[44px] md:min-h-auto"
              disabled={!hasActive}
              aria-label="Cancel all active downloads"
            >
              Cancel All
            </button>
            <button
              onClick={clearCompleted}
              className="text-xs md:text-sm text-content-muted dark:text-content-muted-dark hover:text-success transition-colors px-3 py-2 md:px-2 md:py-1 rounded-md hover:bg-success/10 min-h-[44px] md:min-h-auto"
              disabled={!hasFinished}
              aria-label="Clear all finished downloads"
            >
              Clear Finished
            </button>
            <button 
              onClick={toggleVisibility} 
              className="text-content-muted dark:text-content-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark p-3 md:p-1 rounded-md hover:bg-surface-muted dark:hover:bg-surface-muted-dark transition-colors min-h-[44px] md:min-h-auto flex items-center justify-center" 
              aria-label="Close queue"
            >
              <FaTimes className="text-base md:text-sm" />
            </button>
          </div>
        </header>
        <div className="p-4 overflow-y-auto max-h-[60vh] md:max-h-96 bg-gradient-to-b from-surface-secondary/30 to-surface/30 dark:from-surface-secondary-dark/30 dark:to-surface-dark/30">
          {items.length === 0 ? (
            <div className="text-center py-8 md:py-8">
              <div className="w-20 h-20 md:w-16 md:h-16 mx-auto mb-4 rounded-full bg-surface-muted dark:bg-surface-muted-dark flex items-center justify-center">
                <FaMusic className="text-3xl md:text-2xl icon-muted" />
              </div>
              <p className="text-base md:text-sm text-content-muted dark:text-content-muted-dark">The queue is empty.</p>
              <p className="text-sm md:text-xs text-content-muted dark:text-content-muted-dark mt-1">Downloads will appear here</p>
            </div>
          ) : (
            items.map((item) => <QueueItemCard key={item.id} item={item} />)
          )}
        </div>
      </div>
    </>
  );
};
