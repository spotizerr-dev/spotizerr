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
  { icon: React.ReactNode; color: string; bgColor: string; name: string }
> = {
  queued: {
    icon: <FaHourglassHalf />,
    color: "text-gray-500",
    bgColor: "bg-gray-100",
    name: "Queued",
  },
  initializing: {
    icon: <FaSync className="animate-spin" />,
    color: "text-blue-500",
    bgColor: "bg-blue-100",
    name: "Initializing",
  },
  downloading: {
    icon: <FaSync className="animate-spin" />,
    color: "text-blue-500",
    bgColor: "bg-blue-100",
    name: "Downloading",
  },
  processing: {
    icon: <FaSync className="animate-spin" />,
    color: "text-purple-500",
    bgColor: "bg-purple-100",
    name: "Processing",
  },
  retrying: {
    icon: <FaSync className="animate-spin" />,
    color: "text-orange-500",
    bgColor: "bg-orange-100",
    name: "Retrying",
  },
  completed: {
    icon: <FaCheckCircle />,
    color: "text-green-500",
    bgColor: "bg-green-100",
    name: "Completed",
  },
  done: {
    icon: <FaCheckCircle />,
    color: "text-green-500",
    bgColor: "bg-green-100",
    name: "Done",
  },
  error: {
    icon: <FaExclamationCircle />,
    color: "text-red-500",
    bgColor: "bg-red-100",
    name: "Error",
  },
  cancelled: {
    icon: <FaTimes />,
    color: "text-yellow-500",
    bgColor: "bg-yellow-100",
    name: "Cancelled",
  },
  skipped: {
    icon: <FaTimes />,
    color: "text-gray-500",
    bgColor: "bg-gray-100",
    name: "Skipped",
  },
  pending: {
    icon: <FaHourglassHalf />,
    color: "text-gray-500",
    bgColor: "bg-gray-100",
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
    <div className={`p-4 rounded-lg shadow-md mb-3 transition-all duration-300 ${statusInfo.bgColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <div className={`text-2xl ${statusInfo.color}`}>{statusInfo.icon}</div>
          <div className="flex-grow min-w-0">
            {item.type === "track" && (
              <>
                <div className="flex items-center gap-2">
                  <FaMusic className="text-gray-500" />
                  <p className="font-bold text-gray-800 truncate" title={item.name}>
                    {item.name}
                  </p>
                </div>
                <p className="text-sm text-gray-500 truncate" title={item.artist}>
                  {item.artist}
                </p>
                {item.albumName && (
                  <p className="text-xs text-gray-500 truncate" title={item.albumName}>
                    {item.albumName}
                  </p>
                )}
              </>
            )}
            {item.type === "album" && (
              <>
                <div className="flex items-center gap-2">
                  <FaCompactDisc className="text-gray-500" />
                  <p className="font-bold text-gray-800 truncate" title={item.name}>
                    {item.name}
                  </p>
                </div>
                <p className="text-sm text-gray-500 truncate" title={item.artist}>
                  {item.artist}
                </p>
                {item.currentTrackTitle && (
                  <p className="text-xs text-gray-500 truncate" title={item.currentTrackTitle}>
                    {item.currentTrackNumber}/{item.totalTracks}: {item.currentTrackTitle}
                  </p>
                )}
              </>
            )}
            {item.type === "playlist" && (
              <>
                <div className="flex items-center gap-2">
                  <FaMusic className="text-gray-500" />
                  <p className="font-bold text-gray-800 truncate" title={item.name}>
                    {item.name}
                  </p>
                </div>
                <p className="text-sm text-gray-500 truncate" title={item.playlistOwner}>
                  {item.playlistOwner}
                </p>
                {item.currentTrackTitle && (
                  <p className="text-xs text-gray-500 truncate" title={item.currentTrackTitle}>
                    {item.currentTrackNumber}/{item.totalTracks}: {item.currentTrackTitle}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className={`text-sm font-semibold ${statusInfo.color}`}>{statusInfo.name}</p>
            {progressText && <p className="text-xs text-gray-500">{progressText}</p>}
          </div>
          {isTerminal ? (
            <button
              onClick={() => removeItem?.(item.id)}
              className="text-gray-400 hover:text-red-500 transition-colors"
              aria-label="Remove"
            >
              <FaTimes />
            </button>
          ) : (
            <button
              onClick={() => cancelItem?.(item.id)}
              className="text-gray-400 hover:text-orange-500 transition-colors"
              aria-label="Cancel"
            >
              <FaTimes />
            </button>
          )}
          {item.canRetry && (
            <button
              onClick={() => retryItem?.(item.id)}
              className="text-gray-400 hover:text-blue-500 transition-colors"
              aria-label="Retry"
            >
              <FaSync />
            </button>
          )}
        </div>
      </div>
      {(item.status === "error" || item.status === "retrying") && item.error && (
        <p className="text-xs text-red-600 mt-2">Error: {item.error}</p>
      )}
      {isTerminal && item.summary && (item.summary.total_failed > 0 || item.summary.total_skipped > 0) && (
        <div className="mt-2 text-xs">
          {item.summary.total_failed > 0 && (
            <p className="text-red-600">{item.summary.total_failed} track(s) failed.</p>
          )}
          {item.summary.total_skipped > 0 && (
            <p className="text-yellow-600">{item.summary.total_skipped} track(s) skipped.</p>
          )}
        </div>
      )}
      {(item.status === "downloading" || item.status === "processing") &&
        item.type === "track" &&
        item.progress !== undefined && (
          <div className="mt-2 h-1.5 w-full bg-gray-200 rounded-full">
            <div
              className={`h-1.5 rounded-full ${statusInfo.color.replace("text", "bg")}`}
              style={{ width: `${item.progress}%` }}
            />
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
    <div className="fixed bottom-4 right-4 w-full max-w-md bg-white rounded-lg shadow-xl border border-gray-200 z-50">
      <header className="flex items-center justify-between p-4 border-b border-gray-200">
        <h2 className="text-lg font-bold">Download Queue ({items.length})</h2>
        <div className="flex gap-2">
          <button
            onClick={cancelAll}
            className="text-sm text-gray-500 hover:text-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!hasActive}
            aria-label="Cancel all active downloads"
          >
            Cancel All
          </button>
          <button
            onClick={clearCompleted}
            className="text-sm text-gray-500 hover:text-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!hasFinished}
            aria-label="Clear all finished downloads"
          >
            Clear Finished
          </button>
          <button onClick={toggleVisibility} className="text-gray-500 hover:text-gray-800" aria-label="Close queue">
            <FaTimes />
          </button>
        </div>
      </header>
      <div className="p-4 overflow-y-auto max-h-96">
        {items.length === 0 ? (
          <p className="text-center text-gray-500 py-4">The queue is empty.</p>
        ) : (
          items.map((item) => <QueueItemCard key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
};
