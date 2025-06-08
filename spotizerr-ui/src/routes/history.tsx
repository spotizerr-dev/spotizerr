import { useEffect, useState, useMemo } from 'react';
import apiClient from '../lib/api-client';
import { toast } from 'sonner';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  type SortingState,
} from '@tanstack/react-table';

// --- Type Definitions ---
type HistoryEntry = {
  item_name: string;
  item_artist: string;
  download_type: 'track' | 'album' | 'playlist' | 'artist';
  service_used: string;
  quality_profile: string;
  status_final: 'COMPLETED' | 'ERROR' | 'CANCELLED';
  timestamp_completed: number;
  error_message?: string;
};

// --- Column Definitions ---
const columnHelper = createColumnHelper<HistoryEntry>();
const columns = [
  columnHelper.accessor('item_name', { header: 'Name' }),
  columnHelper.accessor('item_artist', { header: 'Artist' }),
  columnHelper.accessor('download_type', { header: 'Type', cell: info => <span className="capitalize">{info.getValue()}</span> }),
  columnHelper.accessor('status_final', {
    header: 'Status',
    cell: info => {
      const status = info.getValue();
      const statusClass = {
        COMPLETED: 'text-green-500',
        ERROR: 'text-red-500',
        CANCELLED: 'text-yellow-500',
      }[status];
      return <span className={`font-semibold ${statusClass}`}>{status}</span>;
    },
  }),
  columnHelper.accessor('timestamp_completed', {
    header: 'Date Completed',
    cell: info => new Date(info.getValue() * 1000).toLocaleString(),
  }),
  columnHelper.accessor('error_message', {
    header: 'Details',
    cell: info => info.getValue() ? (
        <button onClick={() => toast.info('Error Details', { description: info.getValue() })} className="text-blue-500 hover:underline">
            Show Error
        </button>
    ) : null,
  })
];

export const History = () => {
  const [data, setData] = useState<HistoryEntry[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // State for TanStack Table
  const [sorting, setSorting] = useState<SortingState>([{ id: 'timestamp_completed', desc: true }]);
  const [{ pageIndex, pageSize }, setPagination] = useState({ pageIndex: 0, pageSize: 25 });

  // State for filters
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const pagination = useMemo(() => ({ pageIndex, pageSize }), [pageIndex, pageSize]);

  useEffect(() => {
    const fetchHistory = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
            limit: `${pageSize}`,
            offset: `${pageIndex * pageSize}`,
            sort_by: sorting[0]?.id ?? 'timestamp_completed',
            sort_order: sorting[0]?.desc ? 'DESC' : 'ASC',
        });
        if (statusFilter) params.append('status_final', statusFilter);
        if (typeFilter) params.append('download_type', typeFilter);

        const response = await apiClient.get<{ entries: HistoryEntry[], total_count: number }>(`/history?${params.toString()}`);
        setData(response.data.entries);
        setTotalEntries(response.data.total_count);
      } catch {
        toast.error('Failed to load history.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchHistory();
  }, [pageIndex, pageSize, sorting, statusFilter, typeFilter]);

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

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Download History</h1>

      {/* Filter Controls */}
      <div className="flex gap-4">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700">
            <option value="">All Statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="ERROR">Error</option>
            <option value="CANCELLED">Cancelled</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700">
            <option value="">All Types</option>
            <option value="track">Track</option>
            <option value="album">Album</option>
            <option value="playlist">Playlist</option>
            <option value="artist">Artist</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full">
            <thead>
            {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                    <th key={header.id} className="p-2 text-left">
                    {header.isPlaceholder ? null : (
                        <div
                            {...{
                                className: header.column.getCanSort() ? 'cursor-pointer select-none' : '',
                                onClick: header.column.getToggleSortingHandler(),
                            }}
                        >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: ' ▲', desc: ' ▼'}[header.column.getIsSorted() as string] ?? null}
                        </div>
                    )}
                    </th>
                ))}
                </tr>
            ))}
            </thead>
            <tbody>
            {isLoading ? (
                <tr><td colSpan={columns.length} className="text-center p-4">Loading...</td></tr>
            ) : table.getRowModel().rows.length === 0 ? (
                <tr><td colSpan={columns.length} className="text-center p-4">No history entries found.</td></tr>
            ) : (
                table.getRowModel().rows.map(row => (
                <tr key={row.id} className="border-b dark:border-gray-700">
                    {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className="p-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                    ))}
                </tr>
                ))
            )}
            </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="p-2 border rounded-md disabled:opacity-50">
            Previous
        </button>
        <span>
            Page{' '}
            <strong>
                {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </strong>
        </span>
        <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="p-2 border rounded-md disabled:opacity-50">
            Next
        </button>
        <select
            value={table.getState().pagination.pageSize}
            onChange={e => table.setPageSize(Number(e.target.value))}
            className="p-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
        >
            {[10, 25, 50, 100].map(size => (
                <option key={size} value={size}>
                    Show {size}
                </option>
            ))}
        </select>
      </div>
    </div>
  );
}
