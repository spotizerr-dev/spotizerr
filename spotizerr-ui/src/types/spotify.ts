export interface ImageType {
  url: string;
  height?: number;
  width?: number;
}

export interface ArtistType {
  id: string;
  name: string;
  images?: ImageType[];
}

export interface TrackAlbumInfo {
  id: string;
  name: string;
  images: ImageType[];
  release_date: string;
}

export interface TrackType {
  id: string;
  name: string;
  artists: ArtistType[];
  duration_ms: number;
  explicit: boolean;
  album: TrackAlbumInfo;
  popularity: number;
  external_urls: {
    spotify: string;
  };
}

export interface AlbumType {
  id: string;
  name: string;
  album_type: "album" | "single" | "compilation";
  artists: ArtistType[];
  images: ImageType[];
  release_date: string;
  total_tracks: number;
  label: string;
  copyrights: Array<{ text: string; type: string }>;
  explicit: boolean;
  tracks: {
    items: TrackType[];
  };
}

export interface PlaylistItemType {
  added_at: string;
  is_local: boolean;
  track: TrackType | null;
}

export interface PlaylistOwnerType {
  id: string;
  display_name: string;
}

export interface PlaylistType {
  id: string;
  name: string;
  description: string | null;
  images: ImageType[];
  tracks: {
    items: PlaylistItemType[];
    total: number;
  };
  owner: PlaylistOwnerType;
  followers: {
    total: number;
  };
}

export type SearchResult = (TrackType | AlbumType | ArtistType | PlaylistType) & {
  model: "track" | "album" | "artist" | "playlist";
};
