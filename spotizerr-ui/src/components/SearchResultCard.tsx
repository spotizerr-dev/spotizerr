import { Link } from "@tanstack/react-router";
import { useContext, useEffect } from "react";
import { toast } from "sonner";
import { QueueContext, getStatus } from "../contexts/queue-context";

interface SearchResultCardProps {
  id: string;
  name: string;
  subtitle?: string;
  imageUrl?: string;
  type: "track" | "album" | "artist" | "playlist";
  onDownload?: () => void;
}

export const SearchResultCard = ({ id, name, subtitle, imageUrl, type, onDownload }: SearchResultCardProps) => {
  const context = useContext(QueueContext);
  if (!context) throw new Error("useQueue must be used within a QueueProvider");
  const { items } = context;
  const queueItem = items.find(item => item.downloadType === type && item.spotifyId === id);
  const status = queueItem ? getStatus(queueItem) : null;

  useEffect(() => {
    if (status === "queued") {
      toast.success(`${name} queued.`);
    } else if (status === "error") {
      toast.error(`Failed to queue ${name}`);
    }
  }, [status]);
  const getLinkPath = () => {
    switch (type) {
      case "track":
        return `/track/${id}`;
      case "album":
        return `/album/${id}`;
      case "artist":
        return `/artist/${id}`;
      case "playlist":
        return `/playlist/${id}`;
    }
  };

  return (
    <div className="group flex flex-col rounded-lg overflow-hidden bg-surface dark:bg-surface-secondary-dark hover:bg-surface-secondary dark:hover:bg-surface-muted-dark shadow-xl hover:shadow-2xl transition-shadow duration-300 ease-in-out">
      <div className="relative">
        <Link to={getLinkPath()} className="block">
          <img src={imageUrl || "/placeholder.jpg"} alt={name} className="w-full aspect-square object-cover hover:scale-105 transition-transform duration-300" />
        </Link>
        {onDownload && (
          <button
            onClick={onDownload}
            disabled={!!status && status !== "error"}
            className="absolute bottom-2 right-2 p-2 bg-button-success hover:bg-button-success-hover text-button-success-text rounded-full transition-opacity shadow-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100 duration-300 z-10 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              status
                ? status === "queued"
                  ? `${name} queued`
                  : status === "error"
                  ? `Download ${type}`
                  : "Downloading..."
                : `Download ${type}`
            }
          >
            {status
              ? status === "queued"
                ? "Queued."
                : status === "error"
                ? <img src="/download.svg" alt="Download" className="w-5 h-5 logo" />
                : "Downloading..."
              : <img src="/download.svg" alt="Download" className="w-5 h-5 logo" />
            }
          </button>
        )}
      </div>
      <div className="p-4 flex-grow flex flex-col">
        <Link to={getLinkPath()} className="font-semibold text-content-primary dark:text-content-primary-dark truncate block">
          {name}
        </Link>
        {subtitle && <p className="text-sm text-content-secondary dark:text-content-secondary-dark mt-1 truncate">{subtitle}</p>}
      </div>
    </div>
  );
};
