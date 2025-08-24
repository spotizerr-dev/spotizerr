// Common Interfaces
export interface IDs {
    spotify?: string;
    deezer?: string;
    isrc?: string;
    upc?: string;
}

export interface ReleaseDate {
    year: number;
    month?: number;
    day?: number;
}

// User Model
export interface UserObject {
    name: string;
    type: "user";
    ids: IDs;
}

// Track Module Models

export interface ArtistAlbumTrackObject {
    type: "artistAlbumTrack";
    name: string;
    ids: IDs;
}

export interface ArtistTrackObject {
    type: "artistTrack";
    name: string;
    ids: IDs;
}

export interface AlbumTrackObject {
    type: "albumTrack";
    album_type: "album" | "single" | "compilation";
    title: string;
    release_date: { [key: string]: any };
    total_tracks: number;
    genres: string[];
    images: { [key: string]: any }[];
    ids: IDs;
    artists: ArtistAlbumTrackObject[];
}

export interface PlaylistTrackObject {
    type: "playlistTrack";
    title: string;
    description?: string;
    owner: UserObject;
    ids: IDs;
}

export interface TrackObject {
    type: "track";
    title: string;
    disc_number: number;
    track_number: number;
    duration_ms: number;
    explicit: boolean;
    genres: string[];
    album: AlbumTrackObject;
    artists: ArtistTrackObject[];
    ids: IDs;
}

// Playlist Module Models

export interface ArtistAlbumTrackPlaylistObject {
    type: "artistAlbumTrackPlaylist";
    name: string;
    ids: IDs;
}

export interface AlbumTrackPlaylistObject {
    type: "albumTrackPlaylist";
    album_type: string;
    title: string;
    release_date: { [key: string]: any };
    total_tracks: number;
    images: { [key: string]: any }[];
    ids: IDs;
    artists: ArtistAlbumTrackPlaylistObject[];
}

export interface ArtistTrackPlaylistObject {
    type: "artistTrackPlaylist";
    name: string;
    ids: IDs;
}

export interface TrackPlaylistObject {
    type: "trackPlaylist";
    title: string;
    position: number;
    duration_ms: number;
    artists: ArtistTrackPlaylistObject[];
    album: AlbumTrackPlaylistObject;
    ids: IDs;
    disc_number: number;
    track_number: number;
    explicit: boolean;
}

export interface PlaylistObject {
    type: "playlist";
    title: string;
    description?: string;
    owner: UserObject;
    tracks: TrackPlaylistObject[];
    images: { [key: string]: any }[];
    ids: IDs;
}

// Artist Module Models

export interface AlbumArtistObject {
    type: "albumArtist";
    album_type: string;
    title: string;
    release_date: { [key: string]: any };
    total_tracks: number;
    ids: IDs;
}

export interface ArtistObject {
    type: "artist";
    name: string;
    genres: string[];
    images: { [key: string]: any }[];
    ids: IDs;
    albums: AlbumArtistObject[];
}

// Album Module Models

export interface ArtistTrackAlbumObject {
    type: "artistTrackAlbum";
    name: string;
    ids: IDs;
}

export interface ArtistAlbumObject {
    type: "artistAlbum";
    name: string;
    genres: string[];
    ids: IDs;
}

export interface TrackAlbumObject {
    type: "trackAlbum";
    title: string;
    disc_number: number;
    track_number: number;
    duration_ms: number;
    explicit: boolean;
    genres: string[];
    ids: IDs;
    artists: ArtistTrackAlbumObject[];
}

export interface AlbumObject {
    type: "album";
    album_type: string;
    title: string;
    release_date: { [key: string]: any };
    total_tracks: number;
    genres: string[];
    images: { [key: string]: any }[];
    copyrights: { [key: string]: string }[];
    ids: IDs;
    tracks: TrackAlbumObject[];
    artists: ArtistAlbumObject[];
}

// Callback Module Models

export interface BaseStatusObject {
    ids?: IDs;
    convert_to?: string;
    bitrate?: string;
}

export interface InitializingObject extends BaseStatusObject {
    status: "initializing";
}

export interface SkippedObject extends BaseStatusObject {
    status: "skipped";
    reason: string;
}

export interface RetryingObject extends BaseStatusObject {
    status: "retrying";
    retry_count: number;
    seconds_left: number;
    error: string;
}

export interface RealTimeObject extends BaseStatusObject {
    status: "real-time";
    time_elapsed: number;
    progress: number;
}

export interface ErrorObject extends BaseStatusObject {
    status: "error";
    error: string;
}

export interface FailedTrackObject {
    track: TrackObject;
    reason: string;
}

export interface SummaryObject {
    successful_tracks: TrackObject[];
    skipped_tracks: TrackObject[];
    failed_tracks: FailedTrackObject[];
    total_successful: number;
    total_skipped: number;
    total_failed: number;
    // Optional metadata present in deezspot summaries (album/playlist and sometimes single-track)
    service: "spotify" | "deezer";
    quality: string; // e.g., "ogg", "flac"
    bitrate: string; // e.g., "320k"
    m3u_path?: string; // playlist convenience output
    // Convenience fields that may appear for single-track flows
    final_path?: string;
    download_quality?: string; // e.g., "OGG_320"
}

export interface DoneObject extends BaseStatusObject {
    status: "done";
    summary?: SummaryObject;
    // Convenience fields often present on done for tracks
    final_path?: string;
    download_quality?: string;
}

export type StatusInfo =
    | InitializingObject
    | SkippedObject
    | RetryingObject
    | RealTimeObject
    | ErrorObject
    | DoneObject;

export interface TrackCallbackObject {
    track: TrackObject;
    status_info: StatusInfo;
    current_track?: number;
    total_tracks?: number;
    parent?: AlbumTrackObject | PlaylistTrackObject;
}

export interface AlbumCallbackObject {
    album: AlbumObject;
    status_info: StatusInfo;
}

export interface PlaylistCallbackObject {
    playlist: PlaylistObject;
    status_info: StatusInfo;
}

export interface ProcessingCallbackObject {
    status: "processing";
    timestamp: number;
    type: "track" | "album" | "playlist";
    name: string;
    artist: string;
}

export type CallbackObject =
    | TrackCallbackObject
    | AlbumCallbackObject
    | PlaylistCallbackObject
    | ProcessingCallbackObject;