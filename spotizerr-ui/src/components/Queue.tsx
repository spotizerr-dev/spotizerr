import { useContext, useState, useRef, useEffect } from "react";
import { FaTimes, FaSync, FaCheckCircle, FaExclamationCircle, FaHourglassHalf, FaMusic, FaCompactDisc } from "react-icons/fa";
import { QueueContext, type QueueItem, getStatus, getProgress, getCurrentTrackInfo, isActiveStatus, isTerminalStatus } from "@/contexts/queue-context";

// Circular Progress Component
const CircularProgress = ({ 
  progress, 
  isCompleted = false, 
  size = 60, 
  strokeWidth = 6 
}: { 
  progress: number;
  isCompleted?: boolean;
  size?: number;
  strokeWidth?: number;
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative inline-flex">
      <svg width={size} height={size} className="transform -rotate-90">
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
          strokeDasharray={circumference}
          strokeDashoffset={isCompleted ? 0 : strokeDashoffset}
          className={`transition-all duration-500 ease-out ${
            isCompleted ? "text-success" : "text-info"
          }`}
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

// Status styling configuration
const statusStyles = {
  initializing: {
    icon: <FaSync className="animate-spin icon-accent" />,
    color: "text-info",
    bgColor: "bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/30",
    borderColor: "border-info/30 dark:border-info/40",
    name: "Initializing",
  },
  processing: {
    icon: <FaSync className="animate-spin icon-warning" />,
    color: "text-processing",
    bgColor: "bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/30",
    borderColor: "border-processing/30 dark:border-processing/40",
    name: "Processing",
  },
  downloading: {
    icon: <FaSync className="animate-spin icon-accent" />,
    color: "text-info",
    bgColor: "bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/30",
    borderColor: "border-info/30 dark:border-info/40",
    name: "Downloading",
  },
  "real-time": {
    icon: <FaSync className="animate-spin icon-accent" />,
    color: "text-info",
    bgColor: "bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/30",
    borderColor: "border-info/30 dark:border-info/40",
    name: "Downloading",
  },
  done: {
    icon: <FaCheckCircle className="icon-success" />,
    color: "text-success",
    bgColor: "bg-gradient-to-r from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/30",
    borderColor: "border-success/30 dark:border-success/40",
    name: "Done",
  },
  completed: {
    icon: <FaCheckCircle className="icon-success" />,
    color: "text-success",
    bgColor: "bg-gradient-to-r from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/30",
    borderColor: "border-success/30 dark:border-success/40",
    name: "Completed",
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
  queued: {
    icon: <FaHourglassHalf className="icon-muted" />,
    color: "text-content-muted dark:text-content-muted-dark",
    bgColor: "bg-gradient-to-r from-surface-muted to-surface-accent dark:from-surface-muted-dark dark:to-surface-accent-dark",
    borderColor: "border-border dark:border-border-dark",
    name: "Queued",
  },
  retrying: {
    icon: <FaSync className="animate-spin icon-warning" />,
    color: "text-warning",
    bgColor: "bg-gradient-to-r from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/30",
    borderColor: "border-warning/30 dark:border-warning/40",
    name: "Retrying",
  },
} as const;

// Cancelled Task Component
const CancelledTaskCard = ({ item }: { item: QueueItem }) => {
  const { removeItem } = useContext(QueueContext) || {};
  
  const trackInfo = getCurrentTrackInfo(item);
  const TypeIcon = item.downloadType === "album" ? FaCompactDisc : FaMusic;

  return (
    <div className="p-4 rounded-xl border-2 shadow-lg mb-3 transition-all duration-300 hover:shadow-xl md:hover:scale-[1.02] bg-gradient-to-r from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/30 border-warning/30 dark:border-warning/40">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-0">
        
        {/* Main content */}
        <div className="flex items-center gap-3 md:gap-4 min-w-0 flex-1">
          <div className="text-2xl text-warning bg-white/80 dark:bg-surface-dark/80 p-2 rounded-full shadow-sm flex-shrink-0">
            <FaTimes className="icon-warning" />
          </div>
          
          <div className="flex-grow min-w-0">
            <div className="flex items-center gap-2">
              <TypeIcon className="icon-muted text-sm flex-shrink-0" />
              <p className="font-bold text-base md:text-sm text-content-primary dark:text-content-primary-dark truncate" title={item.name}>
                {item.name}
              </p>
            </div>
            
            <p className="text-sm text-content-secondary dark:text-content-secondary-dark truncate" title={item.artist}>
              {item.artist}
            </p>
            
            {/* Show current track info for parent downloads */}
            {(item.downloadType === "album" || item.downloadType === "playlist") && trackInfo.title && (
              <p className="text-xs text-content-muted dark:text-content-muted-dark truncate" title={trackInfo.title}>
                {trackInfo.current}/{trackInfo.total}: {trackInfo.title}
              </p>
            )}
          </div>
        </div>
        
        {/* Status and actions */}
        <div className="flex items-center justify-between md:justify-end gap-3 md:gap-3 md:ml-4">
          <div className="flex-1 md:flex-none md:text-right">
            <div className="inline-flex items-center px-3 py-1 rounded-full text-sm md:text-xs font-semibold text-warning bg-white/60 dark:bg-surface-dark/60 shadow-sm">
              Cancelled
            </div>
          </div>
          
          {/* Remove button */}
          <div className="flex gap-2 md:gap-1 flex-shrink-0">
            <button
              onClick={() => removeItem?.(item.id)}
              className="p-3 md:p-2 rounded-full bg-white/60 dark:bg-surface-dark/60 text-content-muted dark:text-content-muted-dark hover:text-error hover:bg-error/10 transition-all duration-200 shadow-sm min-h-[44px] md:min-h-auto flex items-center justify-center"
              aria-label="Remove"
            >
              <FaTimes className="text-base md:text-sm" />
            </button>
          </div>
        </div>
      </div>
      
      {/* Cancellation reason */}
      {item.error && (
        <div className="mt-3 p-3 md:p-2 bg-warning/10 border border-warning/20 rounded-lg">
          <p className="text-sm md:text-xs text-warning font-medium break-words">
            Cancelled: {item.error}
          </p>
        </div>
      )}
    </div>
  );
};

const QueueItemCard = ({ item }: { item: QueueItem }) => {
  const { removeItem, cancelItem } = useContext(QueueContext) || {};
  
  const status = getStatus(item);
  const progress = getProgress(item);
  const trackInfo = getCurrentTrackInfo(item);
  const styleInfo = statusStyles[status as keyof typeof statusStyles] || statusStyles.queued;
  const isTerminal = isTerminalStatus(status);
  const isActive = isActiveStatus(status);

  // Get type icon
  const TypeIcon = item.downloadType === "album" ? FaCompactDisc : FaMusic;

  return (
    <div className={`p-4 rounded-xl border-2 shadow-lg mb-3 transition-all duration-300 hover:shadow-xl md:hover:scale-[1.02] ${styleInfo.bgColor} ${styleInfo.borderColor}`}>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-0">
        
        {/* Main content */}
        <div className="flex items-center gap-3 md:gap-4 min-w-0 flex-1">
          <div className={`text-2xl ${styleInfo.color} bg-white/80 dark:bg-surface-dark/80 p-2 rounded-full shadow-sm flex-shrink-0`}>
            {styleInfo.icon}
          </div>
          
          <div className="flex-grow min-w-0">
            <div className="flex items-center gap-2">
              <TypeIcon className="icon-muted text-sm flex-shrink-0" />
              <p className="font-bold text-base md:text-sm text-content-primary dark:text-content-primary-dark truncate" title={item.name}>
                {item.name}
              </p>
            </div>
            
            <p className="text-sm text-content-secondary dark:text-content-secondary-dark truncate" title={item.artist}>
              {item.artist}
            </p>
            
            {/* Show current track info for parent downloads */}
            {(item.downloadType === "album" || item.downloadType === "playlist") && trackInfo.title && (
              <p className="text-xs text-content-muted dark:text-content-muted-dark truncate" title={trackInfo.title}>
                {trackInfo.current}/{trackInfo.total}: {trackInfo.title}
              </p>
            )}
          </div>
        </div>
        
        {/* Status and progress */}
        <div className="flex items-center justify-between md:justify-end gap-3 md:gap-3 md:ml-4">
          <div className="flex-1 md:flex-none md:text-right">
            <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm md:text-xs font-semibold ${styleInfo.color} bg-white/60 dark:bg-surface-dark/60 shadow-sm`}>
              {styleInfo.name}
            </div>
            
            {/* Summary info for completed downloads */}
            {isTerminal && item.summary && item.downloadType !== "track" && (
              <p className="text-sm md:text-xs text-content-muted dark:text-content-muted-dark mt-1">
                {item.summary.total_successful}/{trackInfo.total || item.summary.total_successful + item.summary.total_failed + item.summary.total_skipped} tracks
              </p>
            )}
          </div>
          
          {/* Circular progress for active downloads */}
          {isActive && progress !== undefined && (
            <div className="flex-shrink-0">
              <CircularProgress 
                progress={progress} 
                isCompleted={false}
                size={44}
                strokeWidth={4}
              />
            </div>
          )}
          
          {/* Completed progress for finished downloads */}
          {isTerminal && status === "done" && item.downloadType === "track" && (
            <div className="flex-shrink-0">
              <CircularProgress 
                progress={100} 
                isCompleted={true}
                size={44}
                strokeWidth={4}
              />
            </div>
          )}
          
          {/* Action buttons */}
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
          </div>
        </div>
      </div>
      
      {/* Error message */}
      {item.error && (
        <div className="mt-3 p-3 md:p-2 bg-error/10 border border-error/20 rounded-lg">
          <p className="text-sm md:text-xs text-error font-medium break-words">
            {status === "cancelled" ? "Cancelled: " : "Error: "}
            {item.error}
          </p>
        </div>
      )}
      
      {/* Summary for failed/skipped tracks */}
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
  const [isDragging, setIsDragging] = useState(false);
  const [dragDistance, setDragDistance] = useState(0);
  const queueRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [canDrag, setCanDrag] = useState(false);

  const { 
    items = [], 
    isVisible = false, 
    toggleVisibility = () => {}, 
    cancelAll = () => {}, 
    clearCompleted = () => {}, 
    hasMore = false, 
    isLoadingMore = false, 
    loadMoreTasks = () => {}, 
    totalTasks = 0 
  } = context || {};

  // Infinite scroll
  useEffect(() => {
    if (!isVisible) return;
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;
      if (scrollPercentage > 0.8 && hasMore && !isLoadingMore) {
        loadMoreTasks();
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll);
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, [isVisible, hasMore, isLoadingMore, loadMoreTasks]);

  // Mobile drag-to-dismiss
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const scrollContainer = scrollContainerRef.current;
    const headerElement = headerRef.current;
    
    const touchedHeader = headerElement?.contains(e.target as Node);
    const scrollAtTop = scrollContainer ? scrollContainer.scrollTop <= 5 : true;
    
    if (touchedHeader || scrollAtTop) {
      setCanDrag(true);
      setStartY(touch.clientY);
      setIsDragging(false);
      setDragDistance(0);
    } else {
      setCanDrag(false);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!canDrag || startY === null) return;
    
    const touch = e.touches[0];
    const deltaY = touch.clientY - startY;
    
    if (deltaY > 0) {
      if (!isDragging && deltaY > 10) {
        setIsDragging(true);
        e.preventDefault();
      }
      
      if (isDragging) {
        e.preventDefault();
        e.stopPropagation();
        
        const clampedDelta = Math.min(deltaY, 200);
        setDragDistance(clampedDelta);
        
        if (queueRef.current) {
          const resistance = Math.pow(clampedDelta / 200, 0.7);
          const transformY = clampedDelta * resistance;
          const opacity = Math.max(0.3, 1 - (clampedDelta / 300));
          
          queueRef.current.style.transform = `translateY(${transformY}px)`;
          queueRef.current.style.opacity = `${opacity}`;
          queueRef.current.style.transition = 'none';
        }
      }
    }
  };

  const handleTouchEnd = () => {
    if (!canDrag || startY === null) {
      resetDragState();
      return;
    }
    
    if (queueRef.current) {
      queueRef.current.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
      
      if (isDragging && dragDistance > 80) {
        queueRef.current.style.transform = 'translateY(100%)';
        queueRef.current.style.opacity = '0';
        
        setTimeout(() => {
          toggleVisibility();
          resetDragState();
        }, 300);
      } else {
        queueRef.current.style.transform = '';
        queueRef.current.style.opacity = '';
        
        setTimeout(() => {
          if (queueRef.current) {
            queueRef.current.style.transition = '';
          }
        }, 300);
        
        resetDragState();
      }
    } else {
      resetDragState();
    }
  };

  const resetDragState = () => {
    setStartY(null);
    setIsDragging(false);
    setDragDistance(0);
    setCanDrag(false);
  };

  // Prevent body scroll on mobile
  useEffect(() => {
    if (!isVisible) return;
    const isMobile = window.innerWidth < 768;
    if (!isMobile) return;

    const originalOverflow = document.body.style.overflow;
    const originalTouchAction = document.body.style.touchAction;
    
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.touchAction = originalTouchAction;
    };
  }, [isVisible]);

  if (!context || !isVisible) return null;

  const hasActive = items.some(item => isActiveStatus(getStatus(item)));
  const hasFinished = items.some(item => isTerminalStatus(getStatus(item)));

  // Sort items by priority
  const sortedItems = [...items].sort((a, b) => {
    const statusA = getStatus(a);
    const statusB = getStatus(b);
    
    const getPriority = (status: string) => {
      const priorities = {
        "real-time": 1, downloading: 2, processing: 3, initializing: 4,
        retrying: 5, queued: 6, done: 7, completed: 7, error: 8, cancelled: 9
      };
      return priorities[status as keyof typeof priorities] || 10;
    };

    return getPriority(statusA) - getPriority(statusB);
  });

  return (
    <>
      {/* Mobile backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-40 md:hidden"
        onClick={!isDragging ? toggleVisibility : undefined}
        onTouchStart={(e) => e.preventDefault()}
        onTouchMove={(e) => e.preventDefault()}
        onTouchEnd={(e) => e.preventDefault()}
        style={{ touchAction: 'none', overflowY: 'hidden' }}
      />
      
      <div 
        ref={queueRef}
        className="fixed inset-x-0 bottom-0 md:bottom-4 md:right-4 md:inset-x-auto w-full md:max-w-md bg-surface dark:bg-surface-dark md:rounded-xl shadow-2xl border-t md:border border-border dark:border-border-dark z-50 backdrop-blur-sm"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          touchAction: isDragging ? 'none' : 'auto',
          willChange: isDragging ? 'transform, opacity' : 'auto',
          isolation: 'isolate',
        }}
      >
        <header 
          ref={headerRef}
          className="flex items-center justify-between p-4 border-b border-border dark:border-border-dark bg-gradient-to-r from-surface to-surface-secondary dark:from-surface-dark dark:to-surface-secondary-dark md:rounded-t-xl"
        >
          {/* Drag indicator for mobile */}
          <div className="md:hidden absolute top-2 left-1/2 transform -translate-x-1/2 w-12 h-1 bg-content-muted dark:bg-content-muted-dark rounded-full opacity-50 transition-all duration-200" />
          
          <h2 className="text-lg font-bold text-content-primary dark:text-content-primary-dark">
            Download Queue ({totalTasks})
          </h2>
          
          <div className="flex gap-1 md:gap-2">
            <button
              onClick={cancelAll}
              className="text-xs md:text-sm text-content-muted dark:text-content-muted-dark hover:text-warning transition-colors px-3 py-2 md:px-2 md:py-1 rounded-md hover:bg-warning/10 min-h-[44px] md:min-h-auto"
              disabled={!hasActive}
            >
              Cancel All
            </button>
            <button
              onClick={clearCompleted}
              className="text-xs md:text-sm text-content-muted dark:text-content-muted-dark hover:text-success transition-colors px-3 py-2 md:px-2 md:py-1 rounded-md hover:bg-success/10 min-h-[44px] md:min-h-auto"
              disabled={!hasFinished}
            >
              Clear Finished
            </button>
            <button 
              onClick={toggleVisibility} 
              className="text-content-muted dark:text-content-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark p-3 md:p-1 rounded-md hover:bg-surface-muted dark:hover:bg-surface-muted-dark transition-colors min-h-[44px] md:min-h-auto flex items-center justify-center" 
            >
              <FaTimes className="text-base md:text-sm" />
            </button>
          </div>
        </header>
        
        <div 
          ref={scrollContainerRef}
          className="p-4 overflow-y-auto max-h-[60vh] md:max-h-96 bg-gradient-to-b from-surface-secondary/30 to-surface/30 dark:from-surface-secondary-dark/30 dark:to-surface-dark/30"
          style={{ touchAction: isDragging ? 'none' : 'pan-y' }}
        >
          {(() => {
            const visibleItems = sortedItems.filter(item => !isTerminalStatus(getStatus(item)) || (item.lastCallback && 'timestamp' in item.lastCallback));
            
            return visibleItems.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-20 h-20 md:w-16 md:h-16 mx-auto mb-4 rounded-full bg-surface-muted dark:bg-surface-muted-dark flex items-center justify-center">
                  <FaMusic className="text-3xl md:text-2xl icon-muted" />
                </div>
                <p className="text-base md:text-sm text-content-muted dark:text-content-muted-dark">The queue is empty.</p>
                <p className="text-sm md:text-xs text-content-muted dark:text-content-muted-dark mt-1">Downloads will appear here</p>
              </div>
            ) : (
              <>
                {visibleItems.map(item => {
                  if (getStatus(item) === "cancelled") {
                    return <CancelledTaskCard key={item.id} item={item} />;
                  }
                  return <QueueItemCard key={item.id} item={item} />;
                })}
                
                {/* Loading indicator */}
                {isLoadingMore && (
                  <div className="flex justify-center mt-4 py-4">
                    <div className="flex items-center gap-2 text-content-muted dark:text-content-muted-dark">
                      <div className="w-4 h-4 border-2 border-content-muted dark:border-content-muted-dark border-t-transparent rounded-full animate-spin" />
                      Loading more tasks...
                    </div>
                  </div>
                )}
                
                {/* Load more button */}
                {hasMore && !isLoadingMore && (
                  <div className="flex justify-center mt-4">
                    <button
                      onClick={loadMoreTasks}
                      className="px-3 py-1 text-xs bg-surface-muted dark:bg-surface-muted-dark text-content-secondary dark:text-content-secondary-dark rounded border border-border dark:border-border-dark hover:bg-surface-accent dark:hover:bg-surface-accent-dark hover:text-content-primary dark:hover:text-content-primary-dark transition-colors flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      Load More
                    </button>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </>
  );
};
