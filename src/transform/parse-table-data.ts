/**
 * Shared tabular data parser — CSV and JSON → `TableData`.
 *
 * Used by two consumers:
 *   - `render-evidence.ts`: builds MDAST table nodes for narrative
 *     evidence rendering (citations, artifact cross-references).
 *   - `server/routes/astra.ts`: populates `SerializedOutput.table_data`
 *     so the React renderer can display inline table data on the per-output
 *     spec page without constructing MDAST.
 *
 * Keeping the parser here rather than in each consumer prevents a second
 * CSV/JSON reader from appearing in the system (constitution constraint).
 */

import { readFileSync } from 'node:fs';
import { parse as parsePath } from 'node:path';
import Papa from 'papaparse';

// ── Public types ──────────────────────────────────────────────────────────────

export interface TableData {
  /** Column headers in display order. */
  headers: string[];
  /** Data rows; each is an array parallel to `headers`. */
  rows: string[][];
  /** True when the source has more rows than the configured cap. */
  truncated?: boolean;
}

// ── Row cap ───────────────────────────────────────────────────────────────────

/** Maximum rows to inline.  Reproductions with larger CSVs set `truncated`. */
const MAX_INLINE_ROWS = 200;

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Parse a result file at `filePath` and return `TableData`, or `null` when
 * the extension is unsupported or the file cannot be read / parsed.
 *
 * Supported extensions: `.csv`, `.json`.
 */
export function parseTableData(filePath: string): TableData | null {
  const ext = parsePath(filePath).ext.slice(1).toLowerCase();
  if (ext === 'csv') return parseCSV(filePath);
  if (ext === 'json') return parseJSON(filePath);
  return null;
}

// ── Format helper (used by both CSV and JSON parsers) ─────────────────────────

export function formatValue(val: unknown): string {
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
    return { headers: result.meta.fields ?? [], rows: [] };
  }

  const headers = result.meta.fields as string[];
  const allRows = (result.data as Record<string, string>[]).map((row) =>
    headers.map((h) => row[h] ?? ''),
  );

  if (allRows.length > MAX_INLINE_ROWS) {
    return { headers, rows: allRows.slice(0, MAX_INLINE_ROWS), truncated: true };
  }
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

  // Array of objects: [{ col1: val, col2: val }, ...]
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    const headers = Object.keys(data[0] as Record<string, unknown>);
    const allRows = (data as Record<string, unknown>[]).map((item) =>
      headers.map((h) => formatValue(item[h])),
    );
    if (allRows.length > MAX_INLINE_ROWS) {
      return { headers, rows: allRows.slice(0, MAX_INLINE_ROWS), truncated: true };
    }
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
