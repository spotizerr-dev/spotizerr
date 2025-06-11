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

export interface TrackType {
  id: string;
  name: string;
  artists: ArtistType[];
  duration_ms: number;
  explicit: boolean;
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
