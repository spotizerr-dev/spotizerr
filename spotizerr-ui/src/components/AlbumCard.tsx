import { Link } from "@tanstack/react-router";
import type { AlbumType } from "../types/spotify";

interface AlbumCardProps {
  album: AlbumType;
  onDownload?: () => void;
}

export const AlbumCard = ({ album, onDownload }: AlbumCardProps) => {
  const imageUrl = album.images && album.images.length > 0 ? album.images[0].url : "/placeholder.jpg";
  const subtitle = album.artists.map((artist) => artist.name).join(", ");

  return (
    <div className="group flex flex-col rounded-lg overflow-hidden bg-white dark:bg-gray-800 shadow-xl hover:shadow-2xl transition-all duration-300 ease-in-out hover:-translate-y-1 hover:scale-105">
      <div className="relative">
        <Link to="/album/$albumId" params={{ albumId: album.id }}>
          <img src={imageUrl} alt={album.name} className="w-full aspect-square object-cover" />
          {onDownload && (
            <button
              onClick={(e) => {
                e.preventDefault();
                onDownload();
              }}
              className="absolute bottom-2 right-2 p-2 bg-green-600 text-white rounded-full hover:bg-green-700 transition-opacity shadow-lg opacity-0 group-hover:opacity-100 duration-300"
              title="Download album"
            >
              <img src="/download.svg" alt="Download" className="w-5 h-5" />
            </button>
          )}
        </Link>
      </div>
      <div className="p-4 flex-grow flex flex-col">
        <Link
          to="/album/$albumId"
          params={{ albumId: album.id }}
          className="font-semibold text-gray-900 dark:text-white truncate block"
        >
          {album.name}
        </Link>
        {subtitle && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 truncate">{subtitle}</p>}
      </div>
    </div>
  );
};
