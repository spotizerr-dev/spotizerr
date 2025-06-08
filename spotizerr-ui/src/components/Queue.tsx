import { useQueue, type QueueItem } from '../contexts/queue-context';

export function Queue() {
  const { items, isVisible, removeItem, clearQueue, toggleVisibility } = useQueue();

  if (!isVisible) return null;

  const renderStatus = (item: QueueItem) => {
    switch (item.status) {
      case 'downloading':
        return (
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div
              className="bg-blue-600 h-1.5 rounded-full"
              style={{ width: `${item.progress || 0}%` }}
            ></div>
          </div>
        );
      case 'completed':
        return <span className="text-green-500 font-semibold">Completed</span>;
      case 'error':
        return <span className="text-red-500 font-semibold truncate" title={item.error}>{item.error || 'Failed'}</span>;
      default:
        return <span className="text-gray-500">{item.status}</span>;
    }
  };

  const renderItemDetails = (item: QueueItem) => {
    if (item.status !== 'downloading' || !item.progress) return null;
    return (
        <div className="text-xs text-gray-400 flex justify-between w-full">
            <span>{item.progress.toFixed(0)}%</span>
            <span>{item.speed}</span>
            <span>{item.size}</span>
            <span>{item.eta}</span>
        </div>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 w-96 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 flex flex-col">
      <div className="flex justify-between items-center p-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="font-semibold">Download Queue</h3>
        <div className="flex items-center gap-2">
            <button onClick={clearQueue} className="text-sm text-gray-500 hover:text-red-500" title="Clear All">Clear</button>
            <button onClick={() => toggleVisibility()} className="text-gray-500 hover:text-white" title="Close">
                <img src="/cross.svg" alt="Close" className="w-4 h-4" />
            </button>
        </div>
      </div>
      <div className="p-3 max-h-96 overflow-y-auto space-y-3">
        {items.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-center py-4">Queue is empty.</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="text-sm">
              <div className="flex justify-between items-center">
                  <span className="font-medium truncate pr-2">{item.name}</span>
                  <button onClick={() => removeItem(item.id)} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                    <img src="/cross.svg" alt="Remove" className="w-4 h-4" />
                  </button>
              </div>
              <div className="mt-1 space-y-1">
                {renderStatus(item)}
                {renderItemDetails(item)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
