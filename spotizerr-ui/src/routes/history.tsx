import { useEffect, useState, useMemo, useCallback } from "react";
import apiClient from "../lib/api-client";
import { toast } from "sonner";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  type SortingState,
} from "@tanstack/react-table";

// --- Type Definitions ---
type TimelineEntry = {
  status_type: string;
  timestamp: number;
  human_readable: string;
  status_data: any;
};

type TrackMiniHistory = {
  track_id: string;
  parent_task_id: string;
  position: number;
  disc_number?: number;
  track_number?: number;
  title: string;
  duration_ms?: number;
  explicit?: boolean;
  artists_data?: Array<{ name: string; [key: string]: any }>;
  album_data?: any;
  ids_data?: { spotify?: string; deezer?: string; isrc?: string; upc?: string };
  status_current: string;
  status_final: string;
  timestamp_created: number;
  timestamp_completed?: number;
  timestamp_started?: number;
  time_elapsed?: number;
  calculated_duration?: string;
  retry_count: number;
  progress_info?: any;
  download_path?: string;
  file_size?: number;
  quality_achieved?: string;
  error_info?: { message?: string; [key: string]: any };
  config?: any;
  status_history: Array<any>;
  timeline: TimelineEntry[];
};

type HistoryEntry = {
  task_id: string;
  task_type: "track" | "album" | "playlist" | "artist";
  title: string;
  status_current?: string;
  status_final?: "COMPLETED" | "ERROR" | "CANCELLED" | "SKIPPED";
  timestamp_created?: number;
  timestamp_updated?: number;
  timestamp_completed?: number;
  parent_task_id?: string;
  position?: number;
  
  // Rich data fields
  artists?: Array<{ name: string; [key: string]: any }>;
  ids?: { spotify?: string; deezer?: string; isrc?: string; upc?: string };
  metadata?: any;
  config?: {
    service_used?: string;
    quality_profile?: string;
    convert_to?: string;
    bitrate?: string;
    [key: string]: any;
  };
  error_info?: { message?: string; [key: string]: any };
  progress?: any;
  summary?: {
    total_successful?: number;
    total_skipped?: number;
    total_failed?: number;
    [key: string]: any;
  };
  
  // Child information
  children_table?: string;
  has_children?: boolean;
  child_tracks?: Array<any>;
  child_track_count?: number;
  child_track_summary?: {
    completed: number;
    error: number;
    skipped: number;
  };
  
  // Mini-history fields (when included)
  mini_history?: TrackMiniHistory;
  timeline?: TimelineEntry[];
  retry_count?: number;
  time_elapsed?: number;
  quality_achieved?: string;
  file_size?: number;
  download_path?: string;
  
  // Computed/Legacy compatibility fields
  artist_names?: string[];
  item_name?: string;
  item_artist?: string;
  item_album?: string;
  item_url?: string;
  download_type?: string;
  service_used?: string;
  quality_profile?: string;
  convert_to?: string;
  bitrate?: string;
  error_message?: string;
  timestamp_added?: number;
  track_status?: string;
  total_successful?: number;
  total_skipped?: number;
  total_failed?: number;
};

type TaskDetails = {
  task: HistoryEntry & {
    status_history?: Array<{
      status_id: number;
      status_type: string;
      status_data: any;
      timestamp: number;
    }>;
  };
  include_children: boolean;
  include_status_history: boolean;
};

const STATUS_CLASS: Record<string, string> = {
  COMPLETED: "text-success",
  ERROR: "text-error",
  CANCELLED: "text-content-muted dark:text-content-muted-dark",
  SKIPPED: "text-warning",
};

const QUALITY_MAP: Record<string, Record<string, string>> = {
  spotify: {
    NORMAL: "OGG 96k",
    HIGH: "OGG 160k",
    VERY_HIGH: "OGG 320k",
  },
  deezer: {
    MP3_128: "MP3 128k",
    MP3_320: "MP3 320k",
    FLAC: "FLAC (Hi-Res)",
  },
};

const getDownloadSource = (entry: HistoryEntry): "Spotify" | "Deezer" | "Unknown" => {
  // Check metadata first
  if (entry.metadata?.url) {
    const url = entry.metadata.url.toLowerCase();
    if (url.includes("spotify.com")) return "Spotify";
    if (url.includes("deezer.com")) return "Deezer";
  }
  
  // Check legacy fields
  const url = entry.item_url?.toLowerCase() || "";
  const service = entry.service_used?.toLowerCase() || entry.config?.service_used?.toLowerCase() || "";
  if (url.includes("spotify.com") || service.includes("spotify")) return "Spotify";
  if (url.includes("deezer.com") || service.includes("deezer")) return "Deezer";
  
  // Check IDs
  if (entry.ids?.spotify) return "Spotify";
  if (entry.ids?.deezer) return "Deezer";
  
  return "Unknown";
};

const formatQuality = (entry: HistoryEntry): string => {
  const sourceName = getDownloadSource(entry).toLowerCase();
  const profile = entry.quality_profile || entry.config?.quality_profile || "N/A";
  const sourceQuality = sourceName !== "unknown" ? QUALITY_MAP[sourceName]?.[profile] || profile : profile;
  let qualityDisplay = sourceQuality;
  
  const convertTo = entry.convert_to || entry.config?.convert_to;
  const bitrate = entry.bitrate || entry.config?.bitrate;
  
  if (convertTo && convertTo !== "None") {
    qualityDisplay += ` → ${convertTo.toUpperCase()}`;
    if (bitrate && bitrate !== "None") {
      qualityDisplay += ` ${bitrate}`;
    }
  }
  return qualityDisplay;
};

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return "N/A";
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
};

const formatDuration = (seconds?: number): string => {
  if (!seconds) return "N/A";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

// --- Column Definitions ---
const columnHelper = createColumnHelper<HistoryEntry>();

export const History = () => {
  const [data, setData] = useState<HistoryEntry[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<TaskDetails | null>(null);
  const [selectedTrackMiniHistory, setSelectedTrackMiniHistory] = useState<TrackMiniHistory | null>(null);
  const [showMiniHistories, setShowMiniHistories] = useState(false);
  const [isMiniHistoryLoading, setIsMiniHistoryLoading] = useState(false);

  // State for TanStack Table
  const [sorting, setSorting] = useState<SortingState>([{ id: "timestamp_updated", desc: true }]);
  const [{ pageIndex, pageSize }, setPagination] = useState({
    pageIndex: 0,
    pageSize: 25,
  });

  // State for filters
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [currentStatusFilter, setCurrentStatusFilter] = useState("");
  const [hideChildTracks, setHideChildTracks] = useState(true);
  const [includeChildren, setIncludeChildren] = useState(false);
  const [parentTaskId, setParentTaskId] = useState<string | null>(null);
  const [parentTask, setParentTask] = useState<HistoryEntry | null>(null);

  const pagination = useMemo(() => ({ pageIndex, pageSize }), [pageIndex, pageSize]);

  const viewTracksForParent = useCallback(
    async (parentEntry: HistoryEntry) => {
      try {
        const response = await apiClient.get<{
          parent_task_id: string;
          parent_task_info: {
            title: string;
            task_type: string;
            status_final: string;
          };
          tracks: Array<any>;
          total_count: number;
        }>(`/history/tracks/${parentEntry.task_id}`);

        // Transform tracks to match our HistoryEntry structure
        const transformedTracks = response.data.tracks.map(track => ({
          task_id: track.track_id,
          task_type: "track" as const,
          title: track.title || "Unknown Track",
          status_final: track.status_final,
          timestamp_completed: track.timestamp_completed,
          parent_task_id: track.parent_task_id,
          position: track.position,
          artists: track.artists || [],
          artist_names: track.artist_names || [],
          item_name: track.title || "Unknown Track",
          item_artist: track.artist_names?.join(", ") || "",
          download_type: "track",
          config: track.config,
          error_info: track.error_info,
          // Mini-history fields if available
          mini_history: track.mini_history,
          timeline: track.timeline,
          retry_count: track.retry_count,
          time_elapsed: track.time_elapsed,
          quality_achieved: track.quality_achieved,
          file_size: track.file_size,
          download_path: track.download_path,
          // Legacy compatibility
          service_used: track.config?.service_used,
          quality_profile: track.config?.quality_profile,
          convert_to: track.config?.convert_to,
          bitrate: track.config?.bitrate,
          error_message: track.error_info?.message,
        }));

        setPagination({ pageIndex: 0, pageSize });
        setParentTaskId(parentEntry.task_id);
        setParentTask({
          ...parentEntry,
          item_name: parentEntry.title || parentEntry.item_name,
          item_artist: parentEntry.artist_names?.join(", ") || parentEntry.item_artist,
        });
        setData(transformedTracks);
        setTotalEntries(response.data.total_count);
        setStatusFilter("");
        setTypeFilter("");
        setCurrentStatusFilter("");
      } catch (error) {
        toast.error("Failed to load tracks for this task.");
        console.error("Error loading tracks:", error);
      }
    },
    [pageSize],
  );

  const viewTaskDetails = useCallback(
    async (taskId: string) => {
      try {
        const response = await apiClient.get<TaskDetails>(
          `/history/task/${taskId}?include_children=true&include_status_history=true`
        );
        setSelectedTask(response.data);
      } catch (error) {
        toast.error("Failed to load task details.");
        console.error("Error loading task details:", error);
      }
    },
    [],
  );

  const viewTrackMiniHistory = useCallback(
    async (parentTaskId: string, trackId: string) => {
      setIsMiniHistoryLoading(true);
      try {
        const response = await apiClient.get<{
          parent_task_id: string;
          parent_task_info: any;
          track_mini_history: TrackMiniHistory;
        }>(`/history/track/${parentTaskId}/${trackId}/mini-history`);
        setSelectedTrackMiniHistory(response.data.track_mini_history);
      } catch (error) {
        toast.error("Failed to load track mini-history.");
        console.error("Error loading track mini-history:", error);
      } finally {
        setIsMiniHistoryLoading(false);
      }
    },
    [],
  );

  const loadTracksWithMiniHistories = useCallback(
    async (parentTaskId: string) => {
      try {
        const response = await apiClient.get<{
          parent_task_id: string;
          parent_task_info: any;
          tracks: Array<any>;
          total_count: number;
          include_mini_histories: boolean;
        }>(`/history/tracks/${parentTaskId}?include_mini_histories=true`);
        
        const transformedTracks = response.data.tracks.map(track => ({
          task_id: track.track_id,
          task_type: "track" as const,
          title: track.title || "Unknown Track",
          status_final: track.status_final,
          timestamp_completed: track.timestamp_completed,
          parent_task_id: track.parent_task_id,
          position: track.position,
          artists: track.artists || [],
          artist_names: track.artist_names || [],
          item_name: track.title || "Unknown Track",
          item_artist: track.artist_names?.join(", ") || "",
          download_type: "track",
          config: track.config,
          error_info: track.error_info,
          // Mini-history fields if available
          mini_history: track.mini_history,
          timeline: track.timeline,
          retry_count: track.retry_count,
          time_elapsed: track.time_elapsed,
          quality_achieved: track.quality_achieved,
          file_size: track.file_size,
          download_path: track.download_path,
          // Legacy compatibility
          service_used: track.config?.service_used,
          quality_profile: track.config?.quality_profile,
          convert_to: track.config?.convert_to,
          bitrate: track.config?.bitrate,
          error_message: track.error_info?.message,
        }));

        setData(transformedTracks);
        setTotalEntries(response.data.total_count);
        setShowMiniHistories(true);
      } catch (error) {
        toast.error("Failed to load tracks with mini-histories.");
        console.error("Error loading tracks with mini-histories:", error);
      }
    },
    [],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor("title", {
        header: "Name",
        cell: (info) => {
          const entry = info.row.original;
          const displayName = entry.title || entry.item_name || "Unknown";
          return entry.parent_task_id ? (
            <span className="pl-8 text-muted-foreground">└─ {displayName}</span>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-semibold">{displayName}</span>
              {entry.has_children && (
                <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                  {entry.child_track_count || "N/A"} tracks
                </span>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor("artist_names", {
        header: "Artist",
        cell: (info) => {
          const entry = info.row.original;
          return entry.artist_names?.join(", ") || entry.item_artist || "Unknown Artist";
        },
      }),
      columnHelper.accessor("task_type", {
        header: "Type",
        cell: (info) => {
          const type = info.getValue() || info.row.original.download_type || "unknown";
          return <span className="capitalize">{type}</span>;
        },
      }),
      columnHelper.accessor("config", {
        id: "quality",
        header: "Quality",
        cell: (info) => formatQuality(info.row.original),
      }),
      columnHelper.accessor("status_final", {
        header: "Status",
        cell: (info) => {
          const entry = info.row.original;
          const status = entry.status_final || entry.track_status;
          const statusKey = (status || "").toUpperCase();
          const statusClass = STATUS_CLASS[statusKey] || "text-gray-500";

          return (
            <div className="flex items-center gap-2">
              <span className={`font-semibold ${statusClass}`}>{status || "Unknown"}</span>
              {entry.status_current && entry.status_current !== status && (
                <span className="text-xs text-content-muted dark:text-content-muted-dark">
                  ({entry.status_current})
                </span>
              )}
            </div>
          );
        },
      }),
      columnHelper.display({
        id: "source",
        header: parentTaskId ? "Download Source" : "Search Source",
        cell: (info) => getDownloadSource(info.row.original),
      }),
      ...(showMiniHistories && parentTaskId ? [
        columnHelper.accessor("retry_count", {
          header: "Retries",
          cell: (info) => info.getValue() || 0,
        }),
        columnHelper.accessor("time_elapsed", {
          header: "Duration",
          cell: (info) => formatDuration(info.getValue()),
        }),
        columnHelper.accessor("file_size", {
          header: "File Size",
          cell: (info) => formatFileSize(info.getValue()),
        }),
        columnHelper.accessor("quality_achieved", {
          header: "Quality",
          cell: (info) => info.getValue() || "N/A",
        }),
      ] : []),
      columnHelper.accessor("timestamp_completed", {
        header: "Date Completed",
        cell: (info) => {
          const timestamp = info.getValue() || info.row.original.timestamp_updated;
          return timestamp ? new Date(timestamp * 1000).toLocaleString() : "N/A";
        },
      }),
      ...(!parentTaskId
        ? [
            columnHelper.display({
              id: "actions",
              header: "Actions",
              cell: ({ row }) => {
                const entry = row.original;
                if (!entry.parent_task_id && (entry.task_type === "album" || entry.task_type === "playlist" || entry.download_type === "album" || entry.download_type === "playlist")) {
                  const hasChildren = entry.has_children || 
                    (entry.total_successful ?? 0) > 0 ||
                    (entry.total_skipped ?? 0) > 0 ||
                    (entry.total_failed ?? 0) > 0;
                  
                  return (
                    <div className="flex items-center gap-2">
                      {hasChildren && (
                        <>
                          <button
                            onClick={() => viewTracksForParent(row.original)}
                            className="px-2 py-1 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700"
                          >
                            View Tracks
                          </button>
                          <button
                            onClick={() => loadTracksWithMiniHistories(row.original.task_id)}
                            className="px-2 py-1 text-xs rounded-md bg-purple-600 text-white hover:bg-purple-700"
                          >
                            Mini-Histories
                          </button>
                          <span className="text-xs">
                            <span className="text-green-500">
                              {entry.child_track_summary?.completed || entry.total_successful || 0}
                            </span> /{" "}
                            <span className="text-yellow-500">
                              {entry.child_track_summary?.skipped || entry.total_skipped || 0}
                            </span> /{" "}
                            <span className="text-red-500">
                              {entry.child_track_summary?.error || entry.total_failed || 0}
                            </span>
                          </span>
                        </>
                      )}
                    </div>
                  );
                }
                
                // For tracks in parent task view with mini-histories
                if (parentTaskId && entry.task_type === "track") {
                  return (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => viewTaskDetails(entry.task_id)}
                        className="px-2 py-1 text-xs rounded-md bg-gray-600 text-white hover:bg-gray-700"
                      >
                        Details
                      </button>
                      {showMiniHistories && (
                        <button
                          onClick={() => viewTrackMiniHistory(parentTaskId, entry.task_id)}
                          className="px-2 py-1 text-xs rounded-md bg-green-600 text-white hover:bg-green-700"
                        >
                          Timeline
                        </button>
                      )}
                    </div>
                  );
                }
                
                return (
                  <button
                    onClick={() => viewTaskDetails(entry.task_id)}
                    className="px-2 py-1 text-xs rounded-md bg-gray-600 text-white hover:bg-gray-700"
                  >
                    Details
                  </button>
                );
              },
            }),
          ]
        : []),
    ],
    [viewTracksForParent, viewTaskDetails, loadTracksWithMiniHistories, viewTrackMiniHistory, parentTaskId, showMiniHistories],
  );

  useEffect(() => {
    const fetchHistory = async () => {
      if (parentTaskId) return; // Skip if we're viewing parent tracks (handled separately)
      
      setIsLoading(true);
      setData([]);
      try {
        const params = new URLSearchParams({
          limit: `${pageSize}`,
          offset: `${pageIndex * pageSize}`,
          sort_by: sorting[0]?.id ?? "timestamp_updated",
          sort_order: sorting[0]?.desc ? "DESC" : "ASC",
          include_children: includeChildren.toString(),
        });

        if (statusFilter) params.append("status_final", statusFilter);
        if (typeFilter) params.append("task_type", typeFilter);
        if (currentStatusFilter) params.append("status_current", currentStatusFilter);
        if (hideChildTracks) params.append("hide_child_tracks", "true");

        const response = await apiClient.get<{
          entries: HistoryEntry[];
          total_count: number;
          include_children: boolean;
        }>(`/history?${params.toString()}`);

        setData(response.data.entries);
        setTotalEntries(response.data.total_count);
      } catch (error) {
        toast.error("Failed to load history.");
        console.error("Error loading history:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchHistory();
  }, [pageIndex, pageSize, sorting, statusFilter, typeFilter, currentStatusFilter, hideChildTracks, includeChildren, parentTaskId]);

  const table = useReactTable({
    data,
    columns,
    pageCount: Math.ceil(totalEntries / pageSize),
    state: { sorting, pagination },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    manualSorting: true,
  });

  const clearFilters = () => {
    setStatusFilter("");
    setTypeFilter("");
    setCurrentStatusFilter("");
    setHideChildTracks(true);
    setIncludeChildren(false);
  };

  const viewParentTask = () => {
    setPagination({ pageIndex: 0, pageSize });
    setParentTaskId(null);
    setParentTask(null);
    setShowMiniHistories(false);
    clearFilters();
  };

  const closeTaskDetails = () => {
    setSelectedTask(null);
  };

  const closeMiniHistory = () => {
    setSelectedTrackMiniHistory(null);
  };

  return (
    <div className="space-y-4">
      {/* Task Details Modal */}
      {selectedTask && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface dark:bg-surface-dark rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-content-primary dark:text-content-primary-dark">
                  Task Details
                </h2>
                <button
                  onClick={closeTaskDetails}
                  className="text-content-secondary dark:text-content-secondary-dark hover:text-content-primary dark:hover:text-content-primary-dark"
                >
                  ✕
                </button>
              </div>
              
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-semibold mb-2">Basic Info</h3>
                    <div className="space-y-1 text-sm">
                      <p><strong>ID:</strong> {selectedTask.task.task_id}</p>
                      <p><strong>Type:</strong> {selectedTask.task.task_type}</p>
                      <p><strong>Title:</strong> {selectedTask.task.title}</p>
                      <p><strong>Artists:</strong> {selectedTask.task.artist_names?.join(", ") || "N/A"}</p>
                      <p><strong>Status:</strong> {selectedTask.task.status_final || "N/A"}</p>
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Timestamps</h3>
                    <div className="space-y-1 text-sm">
                      <p><strong>Created:</strong> {selectedTask.task.timestamp_created ? new Date(selectedTask.task.timestamp_created * 1000).toLocaleString() : "N/A"}</p>
                      <p><strong>Updated:</strong> {selectedTask.task.timestamp_updated ? new Date(selectedTask.task.timestamp_updated * 1000).toLocaleString() : "N/A"}</p>
                      <p><strong>Completed:</strong> {selectedTask.task.timestamp_completed ? new Date(selectedTask.task.timestamp_completed * 1000).toLocaleString() : "N/A"}</p>
                    </div>
                  </div>
                </div>

                {selectedTask.task.config && (
                  <div>
                    <h3 className="font-semibold mb-2">Configuration</h3>
                    <div className="bg-surface-secondary dark:bg-surface-secondary-dark p-3 rounded text-sm">
                      <pre className="whitespace-pre-wrap">{JSON.stringify(selectedTask.task.config, null, 2)}</pre>
                    </div>
                  </div>
                )}

                {selectedTask.task.error_info && (
                  <div>
                    <h3 className="font-semibold mb-2 text-error">Error Information</h3>
                    <div className="bg-error/10 border border-error/20 p-3 rounded text-sm">
                      <pre className="whitespace-pre-wrap">{JSON.stringify(selectedTask.task.error_info, null, 2)}</pre>
                    </div>
                  </div>
                )}

                {selectedTask.task.child_tracks && selectedTask.task.child_tracks.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-2">Child Tracks ({selectedTask.task.child_tracks.length})</h3>
                    <div className="max-h-60 overflow-y-auto">
                      <div className="space-y-2">
                        {selectedTask.task.child_tracks.map((track, index) => (
                          <div key={index} className="bg-surface-secondary dark:bg-surface-secondary-dark p-2 rounded text-sm">
                            <div className="font-semibold">{track.track_data?.title || "Unknown Track"}</div>
                            <div className="text-content-secondary dark:text-content-secondary-dark">
                              Status: {track.status_final} | Position: {track.position}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {selectedTask.task.status_history && selectedTask.task.status_history.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-2">Status History</h3>
                    <div className="max-h-60 overflow-y-auto">
                      <div className="space-y-2">
                        {selectedTask.task.status_history.map((status) => (
                          <div key={status.status_id} className="bg-surface-secondary dark:bg-surface-secondary-dark p-2 rounded text-sm">
                            <div className="flex justify-between">
                              <strong>{status.status_type}</strong>
                              <span className="text-content-secondary dark:text-content-secondary-dark">
                                {new Date(status.timestamp * 1000).toLocaleString()}
                              </span>
                            </div>
                            {status.status_data && (
                              <pre className="text-xs mt-1 whitespace-pre-wrap">
                                {JSON.stringify(status.status_data, null, 2)}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Track Mini-History Modal */}
      {selectedTrackMiniHistory && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface dark:bg-surface-dark rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-content-primary dark:text-content-primary-dark">
                  Track Mini-History: {selectedTrackMiniHistory.title}
                </h2>
                <button
                  onClick={closeMiniHistory}
                  className="text-content-secondary dark:text-content-secondary-dark hover:text-content-primary dark:hover:text-content-primary-dark"
                >
                  ✕
                </button>
              </div>
              
              {isMiniHistoryLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-content-muted dark:text-content-muted-dark">Loading mini-history...</div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Track Summary */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-surface-secondary dark:bg-surface-secondary-dark p-4 rounded-lg">
                      <h3 className="font-semibold text-sm text-content-secondary dark:text-content-secondary-dark mb-1">Status</h3>
                      <p className={`font-bold ${STATUS_CLASS[selectedTrackMiniHistory.status_final] || 'text-gray-500'}`}>
                        {selectedTrackMiniHistory.status_final}
                      </p>
                      <p className="text-xs text-content-muted dark:text-content-muted-dark">
                        Current: {selectedTrackMiniHistory.status_current}
                      </p>
                    </div>
                    <div className="bg-surface-secondary dark:bg-surface-secondary-dark p-4 rounded-lg">
                      <h3 className="font-semibold text-sm text-content-secondary dark:text-content-secondary-dark mb-1">Duration</h3>
                      <p className="font-bold text-content-primary dark:text-content-primary-dark">
                        {formatDuration(selectedTrackMiniHistory.time_elapsed)}
                      </p>
                      <p className="text-xs text-content-muted dark:text-content-muted-dark">
                        {selectedTrackMiniHistory.calculated_duration}
                      </p>
                    </div>
                    <div className="bg-surface-secondary dark:bg-surface-secondary-dark p-4 rounded-lg">
                      <h3 className="font-semibold text-sm text-content-secondary dark:text-content-secondary-dark mb-1">File Info</h3>
                      <p className="font-bold text-content-primary dark:text-content-primary-dark">
                        {formatFileSize(selectedTrackMiniHistory.file_size)}
                      </p>
                      <p className="text-xs text-content-muted dark:text-content-muted-dark">
                        {selectedTrackMiniHistory.quality_achieved || "N/A"}
                      </p>
                    </div>
                    <div className="bg-surface-secondary dark:bg-surface-secondary-dark p-4 rounded-lg">
                      <h3 className="font-semibold text-sm text-content-secondary dark:text-content-secondary-dark mb-1">Attempts</h3>
                      <p className="font-bold text-content-primary dark:text-content-primary-dark">
                        {selectedTrackMiniHistory.retry_count + 1}
                      </p>
                      <p className="text-xs text-content-muted dark:text-content-muted-dark">
                        {selectedTrackMiniHistory.retry_count > 0 ? `${selectedTrackMiniHistory.retry_count} retries` : "No retries"}
                      </p>
                    </div>
                  </div>

                  {/* Track Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h3 className="font-semibold mb-2 text-content-primary dark:text-content-primary-dark">Track Info</h3>
                      <div className="space-y-1 text-sm">
                        <p><strong>Position:</strong> {selectedTrackMiniHistory.disc_number}-{selectedTrackMiniHistory.track_number} (#{selectedTrackMiniHistory.position})</p>
                        <p><strong>Duration:</strong> {selectedTrackMiniHistory.duration_ms ? `${Math.floor(selectedTrackMiniHistory.duration_ms / 60000)}:${Math.floor((selectedTrackMiniHistory.duration_ms % 60000) / 1000).toString().padStart(2, '0')}` : "N/A"}</p>
                        <p><strong>Artists:</strong> {selectedTrackMiniHistory.artists_data?.map(a => a.name).join(", ") || "N/A"}</p>
                        <p><strong>Explicit:</strong> {selectedTrackMiniHistory.explicit ? "Yes" : "No"}</p>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-semibold mb-2 text-content-primary dark:text-content-primary-dark">Download Info</h3>
                      <div className="space-y-1 text-sm">
                        <p><strong>Started:</strong> {selectedTrackMiniHistory.timestamp_started ? new Date(selectedTrackMiniHistory.timestamp_started * 1000).toLocaleString() : "N/A"}</p>
                        <p><strong>Completed:</strong> {selectedTrackMiniHistory.timestamp_completed ? new Date(selectedTrackMiniHistory.timestamp_completed * 1000).toLocaleString() : "N/A"}</p>
                        <p><strong>Path:</strong> {selectedTrackMiniHistory.download_path || "N/A"}</p>
                      </div>
                    </div>
                  </div>

                  {/* Timeline */}
                  <div>
                    <h3 className="font-semibold mb-4 text-content-primary dark:text-content-primary-dark">
                      Status Timeline ({selectedTrackMiniHistory.timeline.length} events)
                    </h3>
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {selectedTrackMiniHistory.timeline.map((event, index) => (
                        <div key={index} className="bg-surface-secondary dark:bg-surface-secondary-dark p-3 rounded-lg border-l-4 border-l-primary">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-semibold text-content-primary dark:text-content-primary-dark">
                              {event.status_type}
                            </span>
                            <div className="text-sm text-content-secondary dark:text-content-secondary-dark">
                              <span className="block">{event.human_readable}</span>
                              <span className="text-xs">{new Date(event.timestamp * 1000).toLocaleString()}</span>
                            </div>
                          </div>
                          {event.status_data && Object.keys(event.status_data).length > 0 && (
                            <div className="text-xs">
                              <pre className="bg-surface dark:bg-surface-dark p-2 rounded overflow-x-auto">
                                {JSON.stringify(event.status_data, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Error Information */}
                  {selectedTrackMiniHistory.error_info && (
                    <div>
                      <h3 className="font-semibold mb-2 text-error">Error Information</h3>
                      <div className="bg-error/10 border border-error/20 p-3 rounded text-sm">
                        <pre className="whitespace-pre-wrap">{JSON.stringify(selectedTrackMiniHistory.error_info, null, 2)}</pre>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {parentTaskId && parentTask ? (
        <div className="space-y-4">
          <button onClick={viewParentTask} className="flex items-center gap-2 text-sm hover:underline text-content-secondary dark:text-content-secondary-dark hover:text-content-primary dark:hover:text-content-primary-dark">
            &larr; Back to All History
          </button>
          <div className="rounded-lg border border-border dark:border-border-dark bg-gradient-to-br from-surface to-surface-muted dark:from-surface-dark dark:to-surface-muted-dark p-6 shadow-lg">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-1.5">
                <h2 className="text-3xl font-bold tracking-tight text-content-primary dark:text-content-primary-dark">{parentTask.item_name || parentTask.title}</h2>
                <p className="text-xl text-content-secondary dark:text-content-secondary-dark">{parentTask.item_artist || parentTask.artist_names?.join(", ")}</p>
                <div className="pt-2">
                  <span className="capitalize inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-surface-accent dark:bg-surface-accent-dark text-content-primary dark:text-content-primary-dark">
                    {parentTask.task_type || parentTask.download_type}
                  </span>
                </div>
              </div>
              <div className="space-y-2 text-sm md:text-right">
                <div
                  className={`inline-flex items-center rounded-full border border-border dark:border-border-dark px-3 py-1 text-base font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                    STATUS_CLASS[parentTask.status_final || ""] || "text-gray-500"
                  }`}
                >
                  {parentTask.status_final || "Unknown"}
                </div>
                <p className="text-content-muted dark:text-content-muted-dark pt-2">
                  <span className="font-semibold text-content-primary dark:text-content-primary-dark">Quality: </span>
                  {formatQuality(parentTask)}
                </p>
                <p className="text-content-muted dark:text-content-muted-dark">
                  <span className="font-semibold text-content-primary dark:text-content-primary-dark">Completed: </span>
                  {parentTask.timestamp_completed ? new Date(parentTask.timestamp_completed * 1000).toLocaleString() : "N/A"}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between pt-4">
            <h3 className="text-2xl font-bold tracking-tight text-content-primary dark:text-content-primary-dark">
              Tracks {showMiniHistories ? "(with Mini-Histories)" : ""}
            </h3>
            <div className="flex items-center gap-2">
              {!showMiniHistories ? (
                <button
                  onClick={() => loadTracksWithMiniHistories(parentTaskId)}
                  className="px-3 py-1 text-sm rounded-md bg-purple-600 text-white hover:bg-purple-700"
                >
                  Show Mini-Histories
                </button>
              ) : (
                <button
                  onClick={() => {
                    setShowMiniHistories(false);
                    viewTracksForParent(parentTask);
                  }}
                  className="px-3 py-1 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
                >
                  Show Basic View
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <h1 className="text-3xl font-bold text-content-primary dark:text-content-primary-dark">Download History</h1>
      )}

      {/* Filter Controls - Responsive */}
      {!parentTaskId && (
        <div className="space-y-4">
          {/* Mobile: Stacked filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
            >
              <option value="">All Final Statuses</option>
              <option value="COMPLETED">Completed</option>
              <option value="ERROR">Error</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="SKIPPED">Skipped</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
            >
              <option value="">All Types</option>
              <option value="track">Track</option>
              <option value="album">Album</option>
              <option value="playlist">Playlist</option>
              <option value="artist">Artist</option>
            </select>
            <select
              value={currentStatusFilter}
              onChange={(e) => setCurrentStatusFilter(e.target.value)}
              className="p-2 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
            >
              <option value="">All Current Statuses</option>
              <option value="initializing">Initializing</option>
              <option value="retrying">Retrying</option>
              <option value="real-time">In Progress</option>
              <option value="done">Done</option>
              <option value="error">Error</option>
              <option value="skipped">Skipped</option>
            </select>
            <label className="flex items-center gap-2 text-content-primary dark:text-content-primary-dark">
              <input
                type="checkbox"
                checked={!hideChildTracks}
                onChange={(e) => setHideChildTracks(!e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">Show child tracks</span>
            </label>
            <label className="flex items-center gap-2 text-content-primary dark:text-content-primary-dark">
              <input
                type="checkbox"
                checked={includeChildren}
                onChange={(e) => setIncludeChildren(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">Include child data</span>
            </label>
          </div>
        </div>
      )}

      {/* Desktop Table */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="min-w-full">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="p-2 text-left text-content-primary dark:text-content-primary-dark">
                    {header.isPlaceholder ? null : (
                      <div
                        {...{
                          className: header.column.getCanSort() ? "cursor-pointer select-none" : "",
                          onClick: header.column.getToggleSortingHandler(),
                        }}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: " ▲", desc: " ▼" }[header.column.getIsSorted() as string] ?? null}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="text-center p-4 text-content-muted dark:text-content-muted-dark">
                  Loading...
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center p-4 text-content-muted dark:text-content-muted-dark">
                  No history entries found.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const isParent =
                  !row.original.parent_task_id &&
                  (row.original.task_type === "album" || row.original.task_type === "playlist" || row.original.download_type === "album" || row.original.download_type === "playlist");
                const isChild = !!row.original.parent_task_id;
                let rowClass = "hover:bg-surface-muted dark:hover:bg-surface-muted-dark";
                if (isParent) {
                  rowClass += " bg-surface-accent dark:bg-surface-accent-dark font-semibold hover:bg-surface-muted dark:hover:bg-surface-muted-dark";
                } else if (isChild) {
                  rowClass += " border-t border-dashed border-content-muted dark:border-content-muted-dark border-opacity-20";
                }

                return (
                  <tr key={row.id} className={`border-b border-border dark:border-border-dark ${rowClass}`}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-3 text-content-primary dark:text-content-primary-dark">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card Layout */}
      <div className="lg:hidden space-y-3">
        {isLoading ? (
          <div className="text-center p-8 text-content-muted dark:text-content-muted-dark">
            Loading...
          </div>
        ) : table.getRowModel().rows.length === 0 ? (
          <div className="text-center p-8 text-content-muted dark:text-content-muted-dark">
            No history entries found.
          </div>
        ) : (
          table.getRowModel().rows.map((row) => {
            const entry = row.original;
            const isParent = !entry.parent_task_id && (entry.task_type === "album" || entry.task_type === "playlist" || entry.download_type === "album" || entry.download_type === "playlist");
            const isChild = !!entry.parent_task_id;
            const status = entry.status_final || entry.track_status;
            const statusKey = (status || "").toUpperCase();
            const statusClass = STATUS_CLASS[statusKey] || "text-gray-500";

            let cardClass = "bg-surface dark:bg-surface-secondary-dark rounded-lg border border-border dark:border-border-dark p-4";
            if (isParent) {
              cardClass += " border-l-4 border-l-primary";
            } else if (isChild) {
              cardClass += " ml-4 border-l-2 border-l-content-muted dark:border-l-content-muted-dark";
            }

            return (
              <div key={row.id} className={cardClass}>
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className={`font-semibold text-content-primary dark:text-content-primary-dark truncate ${isChild ? 'text-sm' : 'text-base'}`}>
                      {isChild ? `└─ ${entry.title || entry.item_name}` : entry.title || entry.item_name}
                    </h3>
                    <p className="text-sm text-content-secondary dark:text-content-secondary-dark truncate">
                      {entry.artist_names?.join(", ") || entry.item_artist}
                    </p>
                  </div>
                  <span className={`text-sm font-semibold ${statusClass} ml-2`}>
                    {status}
                  </span>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                  <div>
                    <span className="text-content-muted dark:text-content-muted-dark">Type:</span>
                    <span className="ml-1 capitalize text-content-primary dark:text-content-primary-dark">
                      {entry.task_type || entry.download_type}
                    </span>
                  </div>
                  <div>
                    <span className="text-content-muted dark:text-content-muted-dark">Source:</span>
                    <span className="ml-1 text-content-primary dark:text-content-primary-dark">
                      {getDownloadSource(entry)}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-content-muted dark:text-content-muted-dark">Quality:</span>
                    <span className="ml-1 text-content-primary dark:text-content-primary-dark">
                      {entry.quality_achieved || formatQuality(entry)}
                    </span>
                  </div>
                  {showMiniHistories && parentTaskId && (
                    <>
                      <div>
                        <span className="text-content-muted dark:text-content-muted-dark">Retries:</span>
                        <span className="ml-1 text-content-primary dark:text-content-primary-dark">
                          {entry.retry_count || 0}
                        </span>
                      </div>
                      <div>
                        <span className="text-content-muted dark:text-content-muted-dark">Duration:</span>
                        <span className="ml-1 text-content-primary dark:text-content-primary-dark">
                          {formatDuration(entry.time_elapsed)}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-content-muted dark:text-content-muted-dark">File Size:</span>
                        <span className="ml-1 text-content-primary dark:text-content-primary-dark">
                          {formatFileSize(entry.file_size)}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="col-span-2">
                    <span className="text-content-muted dark:text-content-muted-dark">Completed:</span>
                    <span className="ml-1 text-content-primary dark:text-content-primary-dark">
                      {entry.timestamp_completed ? new Date(entry.timestamp_completed * 1000).toLocaleString() : "N/A"}
                    </span>
                  </div>
                </div>

                {/* Actions for parent entries */}
                {!parentTaskId && isParent && (
                  entry.has_children || entry.total_successful || entry.total_skipped || entry.total_failed
                ) ? (
                  <div className="mt-3 pt-3 border-t border-border dark:border-border-dark flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-success">
                        {entry.child_track_summary?.completed || entry.total_successful || 0} ✓
                      </span>
                      <span className="text-warning">
                        {entry.child_track_summary?.skipped || entry.total_skipped || 0} ⊘
                      </span>
                      <span className="text-error">
                        {entry.child_track_summary?.error || entry.total_failed || 0} ✗
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => viewTracksForParent(entry)}
                        className="px-3 py-1 text-xs rounded-md bg-primary hover:bg-primary-hover text-white"
                      >
                        View Tracks
                      </button>
                      <button
                        onClick={() => loadTracksWithMiniHistories(entry.task_id)}
                        className="px-3 py-1 text-xs rounded-md bg-purple-600 hover:bg-purple-700 text-white"
                      >
                        Mini-Histories
                      </button>
                    </div>
                  </div>
                ) : !parentTaskId ? (
                  <div className="mt-3 pt-3 border-t border-border dark:border-border-dark flex justify-end">
                    <button
                      onClick={() => viewTaskDetails(entry.task_id)}
                      className="px-3 py-1 text-xs rounded-md bg-gray-600 hover:bg-gray-700 text-white"
                    >
                      Details
                    </button>
                  </div>
                ) : parentTaskId ? (
                  <div className="mt-3 pt-3 border-t border-border dark:border-border-dark flex justify-end gap-2">
                    <button
                      onClick={() => viewTaskDetails(entry.task_id)}
                      className="px-3 py-1 text-xs rounded-md bg-gray-600 hover:bg-gray-700 text-white"
                    >
                      Details
                    </button>
                    {showMiniHistories && (
                      <button
                        onClick={() => viewTrackMiniHistory(parentTaskId, entry.task_id)}
                        className="px-3 py-1 text-xs rounded-md bg-green-600 hover:bg-green-700 text-white"
                      >
                        Timeline
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination Controls - Responsive */}
      <div className="space-y-4">
        {/* Mobile: Stacked layout */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center justify-center sm:justify-start gap-2">
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="px-4 py-2 border bg-button-secondary hover:bg-button-secondary-hover text-button-secondary-text hover:text-button-secondary-text-hover border-border dark:border-border-dark rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="px-4 py-2 border bg-button-secondary hover:bg-button-secondary-hover text-button-secondary-text hover:text-button-secondary-text-hover border-border dark:border-border-dark rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center gap-2 text-sm">
            <span className="text-content-primary dark:text-content-primary-dark whitespace-nowrap">
              Page{" "}
              <strong>
                {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
              </strong>
            </span>
            <select
              value={table.getState().pagination.pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
              className="px-3 py-1 border bg-input-background dark:bg-input-background-dark border-input-border dark:border-input-border-dark rounded-md focus:outline-none focus:ring-2 focus:ring-input-focus"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  Show {size}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
