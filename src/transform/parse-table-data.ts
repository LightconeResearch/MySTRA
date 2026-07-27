/**
 * Shared tabular data parser — CSV and JSON → `TableData`.
 *
 * Used by two consumers:
 *   - `render-evidence.ts`: builds MDAST table nodes for narrative
 *     evidence rendering (citations, artifact cross-references).
 *   - `resolved-store.ts`: derives a byte-bounded browser preview.
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
  /** Full source dimensions, retained when the parser applies its safety cap. */
  totalRows?: number;
  totalColumns?: number;
  /** True when the source has more rows than the configured cap. */
  truncated?: boolean;
}

// ── Row cap ───────────────────────────────────────────────────────────────────

/** Build-time safety ceiling; browser payloads are bounded separately by size. */
const MAX_INLINE_ROWS = 1_000;

// ── Entry point ───────────────────────────────────────────────────────────────

/** Lower-cased file extension without the dot (`'csv'`, `'json'`, `''`). */
export function fileExt(filePath: string): string {
  return parsePath(filePath).ext.slice(1).toLowerCase();
}

/** Parsed tables keyed by path, revalidated by mtime — the same file is
 *  referenced many times per page ({astra:value} cells, evidence, the store). */
interface CachedTable {
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  data: TableData | null;
}

const tableCache = new Map<string, CachedTable>();

/**
 * Parse a result file at `filePath` and return `TableData`, or `null` when
 * the extension is unsupported or the file cannot be read / parsed.
 * Results are cached per file and revalidated by mtime.
 *
 * Supported extensions: `.csv`, `.json`.
 */
export function parseTableData(filePath: string): TableData | null {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(filePath);
  } catch {
    return null;
  }
  const cached = tableCache.get(filePath);
  if (
    cached
    && cached.mtimeMs === stat.mtimeMs
    && cached.ctimeMs === stat.ctimeMs
    && cached.size === stat.size
  ) return cached.data;
  const ext = fileExt(filePath);
  const data = ext === 'csv' ? parseCSV(filePath) : ext === 'json' ? parseJSON(filePath) : null;
  tableCache.set(filePath, {
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    size: stat.size,
    data,
  });
  return data;
}

// ── Format helpers (used by both CSV and JSON parsers) ────────────────────────

/** Apply the row cap, marking `truncated` when the source exceeds it. */
function capRows(headers: string[], rows: string[][]): TableData {
  const totalRows = rows.length;
  const totalColumns = Math.max(
    headers.length,
    rows.reduce((largest, row) => Math.max(largest, row.length), 0),
  );
  if (rows.length > MAX_INLINE_ROWS) {
    return {
      headers,
      rows: rows.slice(0, MAX_INLINE_ROWS),
      totalRows,
      totalColumns,
      truncated: true,
    };
  }
  return { headers, rows, totalRows, totalColumns };
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number') {
    if (Number.isNaN(val)) return 'NaN';
    return Number.isInteger(val) ? val.toString() : val.toPrecision(6);
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
    return capRows(result.meta.fields ?? [], []);
  }

  const headers = result.meta.fields as string[];
  const allRows = (result.data as Record<string, string>[]).map((row) =>
    headers.map((h) => row[h] ?? ''),
  );
  return capRows(headers, allRows);
}

// ── JSON ──────────────────────────────────────────────────────────────────────

function parseJSON(filePath: string): TableData | null {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }

  // Array of objects: [{ col1: val, col2: val }, ...]
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    const headers = Object.keys(data[0] as Record<string, unknown>);
    const allRows = (data as Record<string, unknown>[]).map((item) =>
      headers.map((h) => formatValue(item[h])),
    );
    return capRows(headers, allRows);
  }

  // Nested object: { key: { col1: val, col2: val }, ... }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return capRows([], []);

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
      return capRows(headers, rows);
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
    return capRows(headers, rows);
  }

  // Unrecognised shape
  return null;
}
