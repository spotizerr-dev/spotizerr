import { Link } from "@tanstack/react-router";

interface SearchResultCardProps {
  id: string;
  name: string;
  subtitle?: string;
  imageUrl?: string;
  type: "track" | "album" | "artist" | "playlist";
  onDownload?: () => void;
}

export const SearchResultCard = ({ id, name, subtitle, imageUrl, type, onDownload }: SearchResultCardProps) => {
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
    <div className="group flex flex-col rounded-lg overflow-hidden bg-white dark:bg-gray-800 shadow-xl hover:shadow-2xl transition-shadow duration-300 ease-in-out">
      <div className="relative">
        <img src={imageUrl || "/placeholder.jpg"} alt={name} className="w-full aspect-square object-cover" />
        {onDownload && (
          <button
            onClick={onDownload}
            className="absolute bottom-2 right-2 p-2 bg-green-600 text-white rounded-full hover:bg-green-700 transition-opacity shadow-lg opacity-0 group-hover:opacity-100 duration-300"
            title={`Download ${type}`}
          >
            <img src="/download.svg" alt="Download" className="w-5 h-5" />
          </button>
        )}
      </div>
      <div className="p-4 flex-grow flex flex-col">
        <Link to={getLinkPath()} className="font-semibold text-gray-900 dark:text-white truncate block">
          {name}
        </Link>
        {subtitle && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 truncate">{subtitle}</p>}
      </div>
    </div>
  );
};
