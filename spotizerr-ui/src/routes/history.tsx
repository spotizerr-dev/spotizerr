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
type HistoryEntry = {
  task_id: string;
  item_name: string;
  item_artist: string;
  item_url?: string;
  download_type: "track" | "album" | "playlist" | "artist";
  service_used: string;
  quality_profile: string;
  convert_to?: string;
  bitrate?: string;
  status_final: "COMPLETED" | "ERROR" | "CANCELLED" | "SKIPPED";
  timestamp_completed: number;
  error_message?: string;
  parent_task_id?: string;
  track_status?: "SUCCESSFUL" | "SKIPPED" | "FAILED";
  total_successful?: number;
  total_skipped?: number;
  total_failed?: number;
};

const STATUS_CLASS: Record<string, string> = {
  COMPLETED: "text-green-500",
  ERROR: "text-red-500",
  CANCELLED: "text-gray-500",
  SKIPPED: "text-yellow-500",
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
  const url = entry.item_url?.toLowerCase() || "";
  const service = entry.service_used?.toLowerCase() || "";
  if (url.includes("spotify.com")) return "Spotify";
  if (url.includes("deezer.com")) return "Deezer";
  if (service.includes("spotify")) return "Spotify";
  if (service.includes("deezer")) return "Deezer";
  return "Unknown";
};

const formatQuality = (entry: HistoryEntry): string => {
  const sourceName = getDownloadSource(entry).toLowerCase();
  const profile = entry.quality_profile || "N/A";
  const sourceQuality = sourceName !== "unknown" ? QUALITY_MAP[sourceName]?.[profile] || profile : profile;
  let qualityDisplay = sourceQuality;
  if (entry.convert_to && entry.convert_to !== "None") {
    qualityDisplay += ` → ${entry.convert_to.toUpperCase()}`;
    if (entry.bitrate && entry.bitrate !== "None") {
      qualityDisplay += ` ${entry.bitrate}`;
    }
  }
  return qualityDisplay;
};

// --- Column Definitions ---
const columnHelper = createColumnHelper<HistoryEntry>();

export const History = () => {
  const [data, setData] = useState<HistoryEntry[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // State for TanStack Table
  const [sorting, setSorting] = useState<SortingState>([{ id: "timestamp_completed", desc: true }]);
  const [{ pageIndex, pageSize }, setPagination] = useState({
    pageIndex: 0,
    pageSize: 25,
  });

  // State for filters
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [trackStatusFilter, setTrackStatusFilter] = useState("");
  const [showChildTracks, setShowChildTracks] = useState(false);
  const [parentTaskId, setParentTaskId] = useState<string | null>(null);
  const [parentTask, setParentTask] = useState<HistoryEntry | null>(null);

  const pagination = useMemo(() => ({ pageIndex, pageSize }), [pageIndex, pageSize]);

  const viewTracksForParent = useCallback(
    (parentEntry: HistoryEntry) => {
      setPagination({ pageIndex: 0, pageSize });
      setParentTaskId(parentEntry.task_id);
      setParentTask(parentEntry);
      setStatusFilter("");
      setTypeFilter("");
      setTrackStatusFilter("");
    },
    [pageSize],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor("item_name", {
        header: "Name",
        cell: (info) =>
          info.row.original.parent_task_id ? (
            <span className="pl-8 text-muted-foreground">└─ {info.getValue()}</span>
          ) : (
            <span className="font-semibold">{info.getValue()}</span>
          ),
      }),
      columnHelper.accessor("item_artist", { header: "Artist" }),
      columnHelper.accessor("download_type", {
        header: "Type",
        cell: (info) => <span className="capitalize">{info.getValue()}</span>,
      }),
      columnHelper.accessor("quality_profile", {
        header: "Quality",
        cell: (info) => formatQuality(info.row.original),
      }),
      columnHelper.accessor("status_final", {
        header: "Status",
        cell: (info) => {
          const entry = info.row.original;
          const status = entry.parent_task_id ? entry.track_status : entry.status_final;
          const statusKey = (status || "").toUpperCase();
          const statusClass =
            {
              COMPLETED: "text-green-500",
              SUCCESSFUL: "text-green-500",
              ERROR: "text-red-500",
              FAILED: "text-red-500",
              CANCELLED: "text-gray-500",
              SKIPPED: "text-yellow-500",
            }[statusKey] || "text-gray-500";

          return <span className={`font-semibold ${statusClass}`}>{status}</span>;
        },
      }),
      columnHelper.accessor("item_url", {
        id: "source",
        header: parentTaskId ? "Download Source" : "Search Source",
        cell: (info) => getDownloadSource(info.row.original),
      }),
      columnHelper.accessor("timestamp_completed", {
        header: "Date Completed",
        cell: (info) => new Date(info.getValue() * 1000).toLocaleString(),
      }),
      ...(!parentTaskId
        ? [
            columnHelper.display({
              id: "actions",
              header: "Actions",
              cell: ({ row }) => {
                const entry = row.original;
                if (!entry.parent_task_id && (entry.download_type === "album" || entry.download_type === "playlist")) {
                  const hasChildren =
                    (entry.total_successful ?? 0) > 0 ||
                    (entry.total_skipped ?? 0) > 0 ||
                    (entry.total_failed ?? 0) > 0;
                  if (hasChildren) {
                    return (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => viewTracksForParent(row.original)}
                          className="px-2 py-1 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700"
                        >
                          View Tracks
                        </button>
                        <span className="text-xs">
                          <span className="text-green-500">{entry.total_successful ?? 0}</span> /{" "}
                          <span className="text-yellow-500">{entry.total_skipped ?? 0}</span> /{" "}
                          <span className="text-red-500">{entry.total_failed ?? 0}</span>
                        </span>
                      </div>
                    );
                  }
                }
                return null;
              },
            }),
          ]
        : []),
    ],
    [viewTracksForParent, parentTaskId],
  );

  useEffect(() => {
    const fetchHistory = async () => {
      setIsLoading(true);
      setData([]);
      try {
        const params = new URLSearchParams({
          limit: `${pageSize}`,
          offset: `${pageIndex * pageSize}`,
          sort_by: sorting[0]?.id ?? "timestamp_completed",
          sort_order: sorting[0]?.desc ? "DESC" : "ASC",
        });
        if (statusFilter) params.append("status_final", statusFilter);
        if (typeFilter) params.append("download_type", typeFilter);
        if (trackStatusFilter) params.append("track_status", trackStatusFilter);
        if (!parentTaskId && !showChildTracks) {
          params.append("hide_child_tracks", "true");
        }
        if (parentTaskId) params.append("parent_task_id", parentTaskId);

        const response = await apiClient.get<{
          entries: HistoryEntry[];
          total_count: number;
        }>(`/history?${params.toString()}`);

        const originalEntries = response.data.entries;
        let processedEntries = originalEntries;

        // If including child tracks in the main history, group them with their parents
        if (showChildTracks && !parentTaskId) {
          const parents = originalEntries.filter((e) => !e.parent_task_id);
          const childrenByParentId = originalEntries
            .filter((e) => e.parent_task_id)
            .reduce(
              (acc, child) => {
                const parentId = child.parent_task_id!;
                if (!acc[parentId]) {
                  acc[parentId] = [];
                }
                acc[parentId].push(child);
                return acc;
              },
              {} as Record<string, HistoryEntry[]>,
            );

          const groupedEntries: HistoryEntry[] = [];
          parents.forEach((parent) => {
            groupedEntries.push(parent);
            const children = childrenByParentId[parent.task_id];
            if (children) {
              groupedEntries.push(...children);
            }
          });
          processedEntries = groupedEntries;
        }

        // If viewing child tracks for a specific parent, filter out the parent entry from the list
        const finalEntries = parentTaskId
          ? processedEntries.filter((entry) => entry.task_id !== parentTaskId)
          : processedEntries;

        setData(finalEntries);

        // Adjust total count to reflect filtered entries for accurate pagination
        const numFiltered = originalEntries.length - finalEntries.length;
        setTotalEntries(response.data.total_count - numFiltered);
      } catch {
        toast.error("Failed to load history.");
      } finally {
        setIsLoading(false);
      }
    };
    fetchHistory();
  }, [pageIndex, pageSize, sorting, statusFilter, typeFilter, trackStatusFilter, showChildTracks, parentTaskId]);

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
    setTrackStatusFilter("");
    setShowChildTracks(false);
  };

  const viewParentTask = () => {
    setPagination({ pageIndex: 0, pageSize });
    setParentTaskId(null);
    setParentTask(null);
    clearFilters();
  };

  return (
    <div className="space-y-4">
      {parentTaskId && parentTask ? (
        <div className="space-y-4">
          <button onClick={viewParentTask} className="flex items-center gap-2 text-sm hover:underline">
            &larr; Back to All History
          </button>
          <div className="rounded-lg border bg-gradient-to-br from-card to-muted/30 p-6 shadow-lg">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-1.5">
                <h2 className="text-3xl font-bold tracking-tight">{parentTask.item_name}</h2>
                <p className="text-xl text-muted-foreground">{parentTask.item_artist}</p>
                <div className="pt-2">
                  <span className="capitalize inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-secondary text-secondary-foreground">
                    {parentTask.download_type}
                  </span>
                </div>
              </div>
              <div className="space-y-2 text-sm md:text-right">
                <div
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-base font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                    STATUS_CLASS[parentTask.status_final]
                  }`}
                >
                  {parentTask.status_final}
                </div>
                <p className="text-muted-foreground pt-2">
                  <span className="font-semibold text-foreground">Quality: </span>
                  {formatQuality(parentTask)}
                </p>
                <p className="text-muted-foreground">
                  <span className="font-semibold text-foreground">Completed: </span>
                  {new Date(parentTask.timestamp_completed * 1000).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
          <h3 className="text-2xl font-bold tracking-tight pt-4">Tracks</h3>
        </div>
      ) : (
        <h1 className="text-3xl font-bold">Download History</h1>
      )}

      {/* Filter Controls */}
      {!parentTaskId && (
        <div className="flex gap-4 items-center">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
          >
            <option value="">All Statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="ERROR">Error</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="SKIPPED">Skipped</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
          >
            <option value="">All Types</option>
            <option value="track">Track</option>
            <option value="album">Album</option>
            <option value="playlist">Playlist</option>
            <option value="artist">Artist</option>
          </select>
          <select
            value={trackStatusFilter}
            onChange={(e) => setTrackStatusFilter(e.target.value)}
            className="p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
          >
            <option value="">All Track Statuses</option>
            <option value="SUCCESSFUL">Successful</option>
            <option value="SKIPPED">Skipped</option>
            <option value="FAILED">Failed</option>
          </select>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showChildTracks}
              onChange={(e) => setShowChildTracks(e.target.checked)}
              disabled={!!parentTaskId}
            />
            Include child tracks
          </label>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="p-2 text-left">
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
                <td colSpan={columns.length} className="text-center p-4">
                  Loading...
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center p-4">
                  No history entries found.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const isParent =
                  !row.original.parent_task_id &&
                  (row.original.download_type === "album" || row.original.download_type === "playlist");
                const isChild = !!row.original.parent_task_id;
                let rowClass = "hover:bg-muted/50";
                if (isParent) {
                  rowClass += " bg-muted/50 font-semibold hover:bg-muted";
                } else if (isChild) {
                  rowClass += " border-t border-dashed border-muted-foreground/20";
                }

                return (
                  <tr key={row.id} className={`border-b border-border ${rowClass}`}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-3">
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

      {/* Pagination Controls */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          className="p-2 border rounded-md disabled:opacity-50"
        >
          Previous
        </button>
        <span>
          Page{" "}
          <strong>
            {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </strong>
        </span>
        <button
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          className="p-2 border rounded-md disabled:opacity-50"
        >
          Next
        </button>
        <select
          value={table.getState().pagination.pageSize}
          onChange={(e) => table.setPageSize(Number(e.target.value))}
          className="p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
        >
          {[10, 25, 50, 100].map((size) => (
            <option key={size} value={size}>
              Show {size}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
