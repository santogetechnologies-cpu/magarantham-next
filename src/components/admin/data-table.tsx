"use client";
import React, { useState, useMemo } from "react";

export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  exportValue?: (row: T) => string | number;
};

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  searchKey,
  searchPlaceholder = "Search records...",
  title,
  exportFileName = "export",
  actions,
  pageSize = 15,
  emptyMessage = "No records found.",
}: {
  columns: Column<T>[];
  data: T[];
  searchKey?: string | string[];
  searchPlaceholder?: string;
  title?: string;
  exportFileName?: string;
  actions?: React.ReactNode;
  pageSize?: number;
  emptyMessage?: string;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  // Filter
  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const query = search.toLowerCase().trim();
    return data.filter((row) => {
      if (Array.isArray(searchKey)) {
        return searchKey.some((k) =>
          String(row[k] ?? "").toLowerCase().includes(query),
        );
      }
      if (searchKey) {
        return String(row[searchKey] ?? "").toLowerCase().includes(query);
      }
      return Object.values(row).some((val) =>
        String(val ?? "").toLowerCase().includes(query),
      );
    });
  }, [data, search, searchKey]);

  // Sort
  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const valA = a[sortKey];
      const valB = b[sortKey];
      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;
      const cmp = valA < valB ? -1 : 1;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  // Paginate
  const totalPages = Math.ceil(sorted.length / pageSize) || 1;
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function exportCSV() {
    if (!sorted.length) return;
    const headers = columns.map((c) => `"${c.header.replace(/"/g, '""')}"`);
    const rows = sorted.map((row) =>
      columns
        .map((c) => {
          const val = c.exportValue
            ? c.exportValue(row)
            : c.render
              ? String(row[c.key] ?? "")
              : String(row[c.key] ?? "");
          return `"${String(val).replace(/"/g, '""')}"`;
        })
        .join(","),
    );

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${exportFileName}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="luxury-datatable-container">
      {/* Table Toolbar */}
      <div className="datatable-toolbar">
        <div className="toolbar-left">
          {title && <h3 className="datatable-title">{title}</h3>}
          <div className="datatable-search-box">
            <span className="search-symbol">🔍</span>
            <input
              type="search"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="datatable-search-input"
            />
          </div>
        </div>

        <div className="toolbar-right">
          {actions}
          <button
            type="button"
            className="button outline-btn btn-export-csv"
            onClick={exportCSV}
            title="Download table data as CSV"
          >
            <span>📥 Export CSV</span>
          </button>
        </div>
      </div>

      {/* Table Wrapper */}
      <div className="table-responsive-wrapper">
        <table className="luxury-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => c.sortable !== false && handleSort(c.key)}
                  className={c.sortable !== false ? "sortable-th" : ""}
                >
                  <div className="th-content">
                    <span>{c.header}</span>
                    {c.sortable !== false && sortKey === c.key && (
                      <span className="sort-arrow">
                        {sortDir === "asc" ? " ▲" : " ▼"}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length > 0 ? (
              paged.map((row, idx) => (
                <tr key={row.id || idx}>
                  {columns.map((c) => (
                    <td key={c.key}>
                      {c.render ? c.render(row) : String(row[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="table-empty-cell">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="datatable-pagination">
          <span className="page-indicator">
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} of{" "}
            {sorted.length} records
          </span>
          <div className="page-buttons">
            <button
              type="button"
              className="button mini-btn"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              &larr; Previous
            </button>
            <span className="current-page-pill">
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              className="button mini-btn"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              Next &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
