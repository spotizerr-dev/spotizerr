export interface ImageType {
  url: string;
  height?: number;
  width?: number;
}

export interface ArtistType {
  id: string;
  name: string;
  images: ImageType[];
}

export interface TrackAlbumInfo {
  images: ImageType[];
}

export interface TrackType {
  id: string;
  name: string;
  artists: ArtistType[];
  duration_ms: number;
  explicit: boolean;
  album: TrackAlbumInfo;
}

export interface AlbumType {
  id: string;
  name: string;
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
  track: TrackType | null;
}

export interface PlaylistType {
  id: string;
  name: string;
  description: string | null;
  images: ImageType[];
  tracks: {
    items: PlaylistItemType[];
  };
  owner: {
    display_name: string;
  };
}
