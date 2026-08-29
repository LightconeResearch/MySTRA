/**
 * Shared tabular data parser — CSV and JSON → `TableData`.
 *
 * Used by two neutral MyST surfaces:
 *   - `render-evidence.ts`: builds MDAST table nodes for narrative
 *     evidence rendering (citations, artifact cross-references).
 *   - `{astra:value}`: selects and formats one live table cell.
 *
 * Keeping the parser here rather than in each consumer prevents a second
 * CSV/JSON reader from appearing in the system (constitution constraint).
 */

import { readFileSync, statSync } from 'node:fs';
import { parse as parsePath } from 'node:path';
import Papa from 'papaparse';

// ── Public types ──────────────────────────────────────────────────────────────

export interface TableData {
  /** Column headers in display order. */
  headers: string[];
  /** Data rows; each is an array parallel to `headers`. */
  rows: string[][];
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Lower-cased file extension without the dot (`'csv'`, `'json'`, `''`). */
export function fileExt(filePath: string): string {
  return parsePath(filePath).ext.slice(1).toLowerCase();
}

/** Parsed tables keyed by path, revalidated by mtime — the same file is
 *  referenced many times per page ({astra:value} cells, evidence figures,
 *  standalone output blocks), and each miss is a full read plus parse. */
const tableCache = new Map<string, { mtimeMs: number; data: TableData | null }>();

/**
 * Parse a result file at `filePath` and return `TableData`, or `null` when
 * the extension is unsupported or the file cannot be read / parsed.
 *
 * Supported extensions: `.csv`, `.json`. Results are cached per file and
 * revalidated by mtime, so repeated references to one artifact parse it once.
 */
export function parseTableData(filePath: string): TableData | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
  const cached = tableCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.data;

  const ext = fileExt(filePath);
  const data =
    ext === 'csv' ? parseCSV(filePath) : ext === 'json' ? parseJSON(filePath) : null;
  tableCache.set(filePath, { mtimeMs, data });
  return data;
}

// ── Format helpers (used by both CSV and JSON parsers) ────────────────────────

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number') {
    if (Number.isNaN(val)) return 'NaN';
    return String(val);
  }
  if (Array.isArray(val)) return val.map((v) => formatValue(v)).join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function parseCSV(filePath: string): TableData | null {
  let csvText: string;
  try {
    csvText = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  if (!result.data || result.data.length === 0) {
    return { headers: result.meta.fields ?? [], rows: [] };
  }

  const headers = result.meta.fields as string[];
  const allRows = (result.data as Record<string, string>[]).map((row) =>
    headers.map((h) => row[h] ?? ''),
  );
  return { headers, rows: allRows };
}

// ── JSON ──────────────────────────────────────────────────────────────────────

function parseJSON(filePath: string): TableData | null {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }

  if (Array.isArray(data) && data.length === 0) {
    return { headers: [], rows: [] };
  }

  // Array of objects: [{ col1: val, col2: val }, ...]
  if (
    Array.isArray(data) &&
    data.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
  ) {
    const records = data as Record<string, unknown>[];
    const headers = [...new Set(records.flatMap((item) => Object.keys(item)))];
    const allRows = records.map((item) =>
      headers.map((h) => formatValue(item[h])),
    );
    return { headers, rows: allRows };
  }

  // Nested object: { key: { col1: val, col2: val }, ... }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return { headers: [], rows: [] };

    const colSet = new Set<string>();
    for (const [, value] of entries) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const k of Object.keys(value as Record<string, unknown>)) colSet.add(k);
      }
    }
    const columns = Array.from(colSet);

    if (columns.length === 0) {
      // Flat object: { key: value, ... } → two-column table
      const headers = ['Key', 'Value'];
      const rows = entries.map(([k, v]) => [k, formatValue(v)]);
      return { headers, rows };
    }

    // Nested: first column is the outer key, rest are inner object columns
    const headers = ['', ...columns];
    const rows = entries.map(([key, value]) => {
      const record =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      return [key, ...columns.map((col) => formatValue(record[col]))];
    });
    return { headers, rows };
  }

  // Unrecognised shape
  return null;
}
