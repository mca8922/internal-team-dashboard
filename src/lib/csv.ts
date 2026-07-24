'use client';

// Tiny client-side CSV export — no dependency, no server round-trip, so it
// costs nothing against the Vercel/Supabase free tiers. Builds a CSV from an
// array of rows and triggers a browser download.

// Quote a value per RFC 4180: wrap in double-quotes and double any embedded
// quotes whenever it contains a comma, quote, or newline.
//
// Also neutralize spreadsheet formula injection (CWE-1236): a cell that starts
// with =, +, -, @, or a leading tab/CR is treated as a formula by Excel / Google
// Sheets / LibreOffice. Since exported cells include user-controlled free text
// (leave reasons, review notes, names), prefix any such value with a single
// quote so it is always rendered as literal text.
function escapeCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// `columns` maps a header label to a function that pulls the cell from a row,
// keeping the exported columns explicit and in order.
export function downloadCsv<T>(
  filename: string,
  rows: T[],
  columns: { header: string; value: (row: T) => unknown }[],
): void {
  const head = columns.map((c) => escapeCell(c.header)).join(',');
  const body = rows
    .map((row) => columns.map((c) => escapeCell(c.value(row))).join(','))
    .join('\r\n');
  // Prepend a BOM so Excel reads UTF-8 (accented names, etc.) correctly.
  const blob = new Blob(['﻿' + head + '\r\n' + body], {
    type: 'text/csv;charset=utf-8;',
  });
  triggerDownload(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

// Full-fidelity JSON export — a structured backup that keeps nested detail a CSV
// flattens away (e.g. a goal's checklist items). Pretty-printed for readability.
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8;',
  });
  triggerDownload(blob, filename.endsWith('.json') ? filename : `${filename}.json`);
}

// Shared browser "save this blob as a file" plumbing.
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
