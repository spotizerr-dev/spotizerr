import { useQueue, type QueueItem } from "../contexts/queue-context";

export function Queue() {
  const { items, isVisible, removeItem, retryItem, clearQueue, toggleVisibility, clearCompleted } = useQueue();

  if (!isVisible) return null;

  const handleClearQueue = () => {
    if (confirm("Are you sure you want to cancel all downloads and clear the queue?")) {
      clearQueue();
    }
  };

  const renderProgress = (item: QueueItem) => {
    if (item.status === "downloading" || item.status === "processing") {
      const isMultiTrack = item.totalTracks && item.totalTracks > 1;
      const overallProgress =
        isMultiTrack && item.totalTracks
          ? ((item.currentTrackNumber || 0) / item.totalTracks) * 100
          : item.progress || 0;

      return (
        <div className="w-full bg-gray-700 rounded-full h-2.5 mt-1">
          <div className="bg-green-600 h-2.5 rounded-full" style={{ width: `${overallProgress}%` }}></div>
          {isMultiTrack && (
            <div className="w-full bg-gray-600 rounded-full h-1.5 mt-1">
              <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${item.progress || 0}%` }}></div>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  const renderStatusDetails = (item: QueueItem) => {
    const statusClass = {
      initializing: "text-gray-400",
      pending: "text-gray-400",
      downloading: "text-blue-400",
      processing: "text-purple-400",
      completed: "text-green-500 font-semibold",
      error: "text-red-500 font-semibold",
      skipped: "text-yellow-500",
      cancelled: "text-gray-500",
      queued: "text-gray-400",
    }[item.status];

    const isMultiTrack = item.totalTracks && item.totalTracks > 1;

    return (
      <div className="text-xs text-gray-400 flex justify-between w-full mt-1">
        <span className={statusClass}>{item.status.toUpperCase()}</span>
        {item.status === "downloading" && (
          <>
            <span>{item.progress?.toFixed(0)}%</span>
            <span>{item.speed}</span>
            <span>{item.eta}</span>
          </>
        )}
        {isMultiTrack && (
          <span>
            {item.currentTrackNumber}/{item.totalTracks}
          </span>
        )}
      </div>
    );
  };

  const renderSummary = (item: QueueItem) => {
    if (item.status !== "completed" || !item.summary) return null;

    return (
      <div className="text-xs text-gray-300 mt-1">
        <span>
          Success: <span className="text-green-500">{item.summary.successful}</span>
        </span>{" "}
        |{" "}
        <span>
          Skipped: <span className="text-yellow-500">{item.summary.skipped}</span>
        </span>{" "}
        |{" "}
        <span>
          Failed: <span className="text-red-500">{item.summary.failed}</span>
        </span>
      </div>
    );
  };

  return (
    <aside className="fixed top-0 right-0 h-full w-96 bg-gray-900 border-l border-gray-700 z-50 flex flex-col shadow-2xl">
      <header className="flex justify-between items-center p-4 border-b border-gray-700 flex-shrink-0">
        <h3 className="font-semibold text-lg">Download Queue ({items.length})</h3>
        <button onClick={() => toggleVisibility()} className="text-gray-400 hover:text-white" title="Close">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <main className="p-3 flex-grow overflow-y-auto space-y-4">
        {items.length === 0 ? (
          <div className="text-gray-400 text-center py-10">
            <p>The queue is empty.</p>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="text-sm bg-gray-800 p-3 rounded-md border border-gray-700">
              <div className="flex justify-between items-start">
                <span className="font-medium truncate pr-2 flex-grow">{item.name}</span>
                <button
                  onClick={() => removeItem(item.id)}
                  className="text-gray-500 hover:text-red-500 flex-shrink-0"
                  title="Cancel Download"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="mt-2 space-y-1">
                {renderProgress(item)}
                {renderStatusDetails(item)}
                {renderSummary(item)}
                {item.status === "error" && (
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-red-500 text-xs truncate" title={item.error}>
                      {item.error || "An unknown error occurred."}
                    </p>
                    {item.canRetry && (
                      <button
                        onClick={() => retryItem(item.id)}
                        className="text-xs bg-blue-600 hover:bg-blue-700 text-white py-1 px-2 rounded"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </main>

      <footer className="p-3 border-t border-gray-700 flex-shrink-0 flex gap-2">
        <button
          onClick={handleClearQueue}
          className="text-sm bg-red-800 hover:bg-red-700 text-white py-2 px-4 rounded w-full"
        >
          Clear All
        </button>
        <button
          onClick={clearCompleted}
          className="text-sm bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded w-full"
        >
          Clear Completed
        </button>
      </footer>
    </aside>
  );
}
