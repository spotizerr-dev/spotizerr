import { useEffect, useState, useMemo } from "react";
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
  const [hideChildTracks, setHideChildTracks] = useState(true);
  const [parentTaskId, setParentTaskId] = useState<string | null>(null);

  const pagination = useMemo(() => ({ pageIndex, pageSize }), [pageIndex, pageSize]);

  const viewTracksForParent = (taskId: string) => {
    setParentTaskId(taskId);
  };

  const columns = useMemo(
    () => [
      columnHelper.accessor("item_name", {
        header: "Name",
        cell: (info) =>
          info.row.original.parent_task_id ? (
            <span className="pl-4 text-gray-400">└─ {info.getValue()}</span>
          ) : (
            <span className="font-semibold">{info.getValue()}</span>
          ),
      }),
      columnHelper.accessor("item_artist", { header: "Artist" }),
      columnHelper.accessor("download_type", {
        header: "Type",
        cell: (info) => {
          const entry = info.row.original;
          if (entry.parent_task_id && entry.track_status) {
            const statusClass = {
              SUCCESSFUL: "text-green-500",
              SKIPPED: "text-yellow-500",
              FAILED: "text-red-500",
            }[entry.track_status];
            return (
              <span className={`capitalize font-semibold ${statusClass}`}>{entry.track_status.toLowerCase()}</span>
            );
          }
          return <span className="capitalize">{info.getValue()}</span>;
        },
      }),
      columnHelper.accessor("quality_profile", {
        header: "Quality",
        cell: (info) => {
          const entry = info.row.original;
          let qualityDisplay = entry.quality_profile || "N/A";

          if (entry.convert_to && entry.convert_to !== "None") {
            qualityDisplay = `${entry.convert_to.toUpperCase()}`;
            if (entry.bitrate && entry.bitrate !== "None") {
              qualityDisplay += ` ${entry.bitrate}k`;
            }
            qualityDisplay += ` (${entry.quality_profile || "Original"})`;
          } else if (entry.bitrate && entry.bitrate !== "None") {
            qualityDisplay = `${entry.bitrate}k (${entry.quality_profile || "Profile"})`;
          }
          return qualityDisplay;
        },
      }),
      columnHelper.accessor("status_final", {
        header: "Status",
        cell: (info) => {
          const status = info.getValue();
          const statusClass = {
            COMPLETED: "text-green-500",
            ERROR: "text-red-500",
            CANCELLED: "text-gray-500",
            SKIPPED: "text-yellow-500",
          }[status];
          return <span className={`font-semibold ${statusClass}`}>{status}</span>;
        },
      }),
      columnHelper.accessor("timestamp_completed", {
        header: "Date Completed",
        cell: (info) => new Date(info.getValue() * 1000).toLocaleString(),
      }),
      columnHelper.accessor("error_message", {
        header: "Details",
        cell: (info) =>
          info.getValue() ? (
            <button
              onClick={() =>
                toast.info("Error Details", {
                  description: info.getValue(),
                })
              }
              className="text-blue-500 hover:underline"
            >
              Show Error
            </button>
          ) : null,
      }),
      columnHelper.display({
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const entry = row.original;
          if (!entry.parent_task_id && (entry.download_type === "album" || entry.download_type === "playlist")) {
            const hasChildren =
              (entry.total_successful ?? 0) > 0 || (entry.total_skipped ?? 0) > 0 || (entry.total_failed ?? 0) > 0;
            if (hasChildren) {
              return (
                <div className="flex items-center gap-2">
                  <button onClick={() => viewTracksForParent(entry.task_id)} className="text-blue-500 hover:underline">
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
    ],
    [],
  );

  useEffect(() => {
    const fetchHistory = async () => {
      setIsLoading(true);
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
        if (hideChildTracks) params.append("hide_child_tracks", "true");
        if (parentTaskId) params.append("parent_task_id", parentTaskId);

        const response = await apiClient.get<{
          entries: HistoryEntry[];
          total_count: number;
        }>(`/history?${params.toString()}`);
        setData(response.data.entries);
        setTotalEntries(response.data.total_count);
      } catch {
        toast.error("Failed to load history.");
      } finally {
        setIsLoading(false);
      }
    };
    fetchHistory();
  }, [pageIndex, pageSize, sorting, statusFilter, typeFilter, trackStatusFilter, hideChildTracks, parentTaskId]);

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
    setHideChildTracks(true);
  };

  const viewParentTask = () => {
    setParentTaskId(null);
    clearFilters();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Download History</h1>
      {parentTaskId && (
        <button onClick={viewParentTask} className="text-blue-500 hover:underline">
          &larr; Back to All History
        </button>
      )}

      {/* Filter Controls */}
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
          <input type="checkbox" checked={hideChildTracks} onChange={(e) => setHideChildTracks(e.target.checked)} />
          Hide Child Tracks
        </label>
      </div>

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
                const rowClass = isParent ? "bg-gray-800 font-semibold" : isChild ? "bg-gray-900" : "";

                return (
                  <tr key={row.id} className={`border-b dark:border-gray-700 ${rowClass}`}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-2">
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
