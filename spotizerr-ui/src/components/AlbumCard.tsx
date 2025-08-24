import { Link } from "@tanstack/react-router";
import { useContext, useEffect } from "react";
import { toast } from "sonner";
import { QueueContext, getStatus } from "../contexts/queue-context";
import type { AlbumType } from "../types/spotify";

interface AlbumCardProps {
  album: AlbumType;
  onDownload?: () => void;
}

export const AlbumCard = ({ album, onDownload }: AlbumCardProps) => {
  const context = useContext(QueueContext);
  if (!context) throw new Error("useQueue must be used within a QueueProvider");
  const { items } = context;
  const queueItem = items.find(item => item.downloadType === "album" && item.spotifyId === album.id);
  const status = queueItem ? getStatus(queueItem) : null;

  useEffect(() => {
    if (status === "queued") {
      toast.success(`${album.name} queued.`);
    } else if (status === "error") {
      toast.error(`Failed to queue ${album.name}`);
    }
  }, [status, album.name]);
  const imageUrl = album.images && album.images.length > 0 ? album.images[0].url : "/placeholder.jpg";
  const subtitle = album.artists.map((artist) => artist.name).join(", ");

  return (
    <div className="group flex flex-col rounded-lg overflow-hidden bg-surface dark:bg-surface-secondary-dark hover:bg-surface-secondary dark:hover:bg-surface-muted-dark shadow-xl hover:shadow-2xl transition-all duration-300 ease-in-out hover:-translate-y-1 hover:scale-105">
      <div className="relative">
        <Link to="/album/$albumId" params={{ albumId: album.id }}>
          <img src={imageUrl} alt={album.name} className="w-full aspect-square object-cover" />
          {onDownload && (
            <button
              onClick={(e) => {
                e.preventDefault();
                onDownload();
              }}
              disabled={!!status && status !== "error"}
              className="absolute bottom-2 right-2 p-2 bg-button-success hover:bg-button-success-hover text-button-success-text rounded-full transition-opacity shadow-lg opacity-0 group-hover:opacity-100 duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              title={
                status
                  ? status === "queued"
                    ? "Album queued"
                    : status === "error"
                    ? "Download album"
                    : "Downloading..."
                  : "Download album"
              }
            >
              {status
                ? status === "queued"
                  ? "Queued."
                  : status === "error"
                  ? <img src="/download.svg" alt="Download" className="w-5 h-5 icon-inverse" />
                  : <img src="/spinner.svg" alt="Loading" className="w-5 h-5 animate-spin" />
                : <img src="/download.svg" alt="Download" className="w-5 h-5 icon-inverse" />
              }
            </button>
          )}
        </Link>
      </div>
      <div className="p-4 flex-grow flex flex-col">
        <Link
          to="/album/$albumId"
          params={{ albumId: album.id }}
          className="font-semibold text-content-primary dark:text-content-primary-dark truncate block"
        >
          {album.name}
        </Link>
        {subtitle && <p className="text-sm text-content-secondary dark:text-content-secondary-dark mt-1 truncate">{subtitle}</p>}
      </div>
    </div>
  );
};
