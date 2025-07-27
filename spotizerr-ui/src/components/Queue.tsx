import { useContext } from "react";
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
};

const QueueItemCard = ({ item }: { item: QueueItem }) => {
  const { removeItem, retryItem, cancelItem } = useContext(QueueContext) || {};
  const statusInfo = statusStyles[item.status] || statusStyles.queued;
  const isTerminal = isTerminalStatus(item.status);

  const getProgressText = () => {
    const { status, type, progress, totalTracks, summary } = item;

    if (status === "downloading" || status === "processing") {
      if (type === "track") {
        return progress !== undefined ? `${progress.toFixed(0)}%` : null;
      }
      // For albums/playlists, detailed progress is in the main body
      return null;
    }

    if ((status === "completed" || status === "done") && summary) {
      if (type === "track") {
        if (summary.total_successful > 0) return "Completed";
        if (summary.total_failed > 0) return "Failed";
        return "Finished";
      }
      return `${summary.total_successful}/${totalTracks} tracks`;
    }

    return null;
  };

  const progressText = getProgressText();

  return (
    <div className={`p-4 rounded-xl border-2 shadow-lg mb-3 transition-all duration-300 hover:shadow-xl hover:scale-[1.02] ${statusInfo.bgColor} ${statusInfo.borderColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className={`text-2xl ${statusInfo.color} bg-white/80 dark:bg-surface-dark/80 p-2 rounded-full shadow-sm`}>
            {statusInfo.icon}
          </div>
          <div className="flex-grow min-w-0">
            {item.type === "track" && (
              <>
                <div className="flex items-center gap-2">
                  <FaMusic className="icon-muted text-sm" />
                  <p className="font-bold text-content-primary dark:text-content-primary-dark truncate" title={item.name}>
                    {item.name}
                  </p>
                </div>
                <p className="text-sm text-content-secondary dark:text-content-secondary-dark truncate" title={item.artist}>
                  {item.artist}
                </p>
                {item.albumName && (
                  <p className="text-xs text-content-muted dark:text-content-muted-dark truncate" title={item.albumName}>
                    {item.albumName}
                  </p>
                )}
              </>
            )}
            {item.type === "album" && (
              <>
                <div className="flex items-center gap-2">
                  <FaCompactDisc className="icon-muted text-sm" />
                  <p className="font-bold text-content-primary dark:text-content-primary-dark truncate" title={item.name}>
                    {item.name}
                  </p>
                </div>
                <p className="text-sm text-content-secondary dark:text-content-secondary-dark truncate" title={item.artist}>
                  {item.artist}
                </p>
                {item.currentTrackTitle && (
                  <p className="text-xs text-content-muted dark:text-content-muted-dark truncate" title={item.currentTrackTitle}>
                    {item.currentTrackNumber}/{item.totalTracks}: {item.currentTrackTitle}
                  </p>
                )}
              </>
            )}
            {item.type === "playlist" && (
              <>
                <div className="flex items-center gap-2">
                  <FaMusic className="icon-muted text-sm" />
                  <p className="font-bold text-content-primary dark:text-content-primary-dark truncate" title={item.name}>
                    {item.name}
                  </p>
                </div>
                <p className="text-sm text-content-secondary dark:text-content-secondary-dark truncate" title={item.playlistOwner}>
                  {item.playlistOwner}
                </p>
                {item.currentTrackTitle && (
                  <p className="text-xs text-content-muted dark:text-content-muted-dark truncate" title={item.currentTrackTitle}>
                    {item.currentTrackNumber}/{item.totalTracks}: {item.currentTrackTitle}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 ml-4">
          <div className="text-right">
            <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${statusInfo.color} bg-white/60 dark:bg-surface-dark/60 shadow-sm`}>
              {statusInfo.name}
            </div>
            {progressText && <p className="text-xs text-content-muted dark:text-content-muted-dark mt-1">{progressText}</p>}
          </div>
          <div className="flex gap-1">
            {isTerminal ? (
              <button
                onClick={() => removeItem?.(item.id)}
                className="p-2 rounded-full bg-white/60 dark:bg-surface-dark/60 text-content-muted dark:text-content-muted-dark hover:text-error hover:bg-error/10 transition-all duration-200 shadow-sm"
                aria-label="Remove"
              >
                <FaTimes className="text-sm" />
              </button>
            ) : (
              <button
                onClick={() => cancelItem?.(item.id)}
                className="p-2 rounded-full bg-white/60 dark:bg-surface-dark/60 text-content-muted dark:text-content-muted-dark hover:text-warning hover:bg-warning/10 transition-all duration-200 shadow-sm"
                aria-label="Cancel"
              >
                <FaTimes className="text-sm" />
              </button>
            )}
            {item.canRetry && (
              <button
                onClick={() => retryItem?.(item.id)}
                className="p-2 rounded-full bg-white/60 dark:bg-surface-dark/60 text-content-muted dark:text-content-muted-dark hover:text-info hover:bg-info/10 transition-all duration-200 shadow-sm"
                aria-label="Retry"
              >
                <FaSync className="text-sm" />
              </button>
            )}
          </div>
        </div>
      </div>
      {(item.status === "error" || item.status === "retrying") && item.error && (
        <div className="mt-3 p-2 bg-error/10 border border-error/20 rounded-lg">
          <p className="text-xs text-error font-medium">Error: {item.error}</p>
        </div>
      )}
      {isTerminal && item.summary && (item.summary.total_failed > 0 || item.summary.total_skipped > 0) && (
        <div className="mt-3 p-2 bg-surface/50 dark:bg-surface-dark/50 rounded-lg">
          <div className="flex gap-4 text-xs">
            {item.summary.total_failed > 0 && (
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 bg-error rounded-full"></div>
                <span className="text-error font-medium">{item.summary.total_failed} failed</span>
              </span>
            )}
            {item.summary.total_skipped > 0 && (
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 bg-warning rounded-full"></div>
                <span className="text-warning font-medium">{item.summary.total_skipped} skipped</span>
              </span>
            )}
          </div>
        </div>
      )}
      {(item.status === "downloading" || item.status === "processing") &&
        item.type === "track" &&
        item.progress !== undefined && (
          <div className="mt-3">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-content-muted dark:text-content-muted-dark">Progress</span>
              <span className="text-xs font-semibold text-content-primary dark:text-content-primary-dark">{item.progress.toFixed(0)}%</span>
            </div>
            <div className="h-2 w-full bg-surface/50 dark:bg-surface-dark/50 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ease-out ${
                  item.status === "downloading" ? "bg-info" : "bg-processing"
                }`}
                style={{ width: `${item.progress}%` }}
              />
            </div>
          </div>
        )}
    </div>
  );
};

export const Queue = () => {
  const context = useContext(QueueContext);

  if (!context) return null;
  const { items, isVisible, toggleVisibility, cancelAll, clearCompleted } = context;

  if (!isVisible) return null;

  const hasActive = items.some((item) => !isTerminalStatus(item.status));
  const hasFinished = items.some((item) => isTerminalStatus(item.status));

  return (
    <div className="fixed bottom-4 right-4 w-full max-w-md bg-surface dark:bg-surface-dark rounded-xl shadow-2xl border border-border dark:border-border-dark z-50 backdrop-blur-sm">
      <header className="flex items-center justify-between p-4 border-b border-border dark:border-border-dark bg-gradient-to-r from-surface to-surface-secondary dark:from-surface-dark dark:to-surface-secondary-dark rounded-t-xl">
        <h2 className="text-lg font-bold text-content-primary dark:text-content-primary-dark">
          Download Queue ({items.length})
        </h2>
        <div className="flex gap-2">
          <button
            onClick={cancelAll}
            className="text-sm text-content-muted dark:text-content-muted-dark hover:text-warning transition-colors px-2 py-1 rounded-md hover:bg-warning/10"
            disabled={!hasActive}
            aria-label="Cancel all active downloads"
          >
            Cancel All
          </button>
          <button
            onClick={clearCompleted}
            className="text-sm text-content-muted dark:text-content-muted-dark hover:text-success transition-colors px-2 py-1 rounded-md hover:bg-success/10"
            disabled={!hasFinished}
            aria-label="Clear all finished downloads"
          >
            Clear Finished
          </button>
          <button 
            onClick={toggleVisibility} 
            className="text-content-muted dark:text-content-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark p-1 rounded-md hover:bg-surface-muted dark:hover:bg-surface-muted-dark transition-colors" 
            aria-label="Close queue"
          >
            <FaTimes className="text-sm" />
          </button>
        </div>
      </header>
      <div className="p-4 overflow-y-auto max-h-96 bg-gradient-to-b from-surface-secondary/30 to-surface/30 dark:from-surface-secondary-dark/30 dark:to-surface-dark/30">
        {items.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-muted dark:bg-surface-muted-dark flex items-center justify-center">
              <FaMusic className="text-2xl icon-muted" />
            </div>
            <p className="text-content-muted dark:text-content-muted-dark">The queue is empty.</p>
            <p className="text-xs text-content-muted dark:text-content-muted-dark mt-1">Downloads will appear here</p>
          </div>
        ) : (
          items.map((item) => <QueueItemCard key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
};
