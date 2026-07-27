import type { TableData } from './parse-table-data.js';

/** Transport budget for one table preview embedded in a page payload. */
export const TABLE_PREVIEW_BUDGET_BYTES = 64 * 1024;

/** Independent safety ceilings; the theme owns the much smaller display cap. */
const TABLE_PREVIEW_MAX_ROWS = 1_000;
const TABLE_PREVIEW_MAX_COLUMNS = 100;
const TABLE_PREVIEW_MAX_CELL_BYTES = 8 * 1024;

export interface SerializedTablePreview extends TableData {
  total_rows: number;
  total_columns: number;
  serialized_bytes: number;
  truncated: boolean;
  cells_truncated?: boolean;
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function truncateString(
  value: string,
  maxBytes: number,
): { value: string; truncated: boolean } {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return { value, truncated: false };
  }
  const suffix = '…';
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  let bytes = 0;
  let output = '';
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes + suffixBytes > maxBytes) break;
    output += character;
    bytes += characterBytes;
  }
  return { value: output + suffix, truncated: true };
}

function previewCell(value: string): { value: string; truncated: boolean } {
  return truncateString(value, TABLE_PREVIEW_MAX_CELL_BYTES);
}

function previewEnvelope(
  headers: string[],
  rows: string[][],
  totalRows: number,
  totalColumns: number,
  cellsTruncated: boolean,
  serializedBytes: number,
): SerializedTablePreview {
  const truncated =
    headers.length < totalColumns
    || rows.length < totalRows
    || rows.some((row) => row.length < totalColumns)
    || cellsTruncated;
  return {
    headers,
    rows,
    total_rows: totalRows,
    total_columns: totalColumns,
    serialized_bytes: serializedBytes,
    truncated,
    ...(cellsTruncated ? { cells_truncated: true } : {}),
  };
}

function measuredPreview(
  headers: string[],
  rows: string[][],
  totalRows: number,
  totalColumns: number,
  cellsTruncated: boolean,
): SerializedTablePreview {
  let bytes = 0;
  let preview = previewEnvelope(
    headers,
    rows,
    totalRows,
    totalColumns,
    cellsTruncated,
    bytes,
  );
  // The byte count contributes a few digits to its own JSON representation.
  // Iterate until its width stabilizes so the reported size is exact.
  for (let index = 0; index < 4; index += 1) {
    const measured = jsonBytes(preview);
    if (measured === bytes) break;
    bytes = measured;
    preview = { ...preview, serialized_bytes: bytes };
  }
  return preview;
}

/**
 * Build a deterministic, rectangular prefix of a table within a UTF-8 JSON
 * byte budget. Complete cells are retained; exceptionally large strings are
 * shortened explicitly and marked in the preview metadata.
 */
export function buildTablePreview(
  table: TableData,
  budgetBytes = TABLE_PREVIEW_BUDGET_BYTES,
): SerializedTablePreview | undefined {
  const totalRows = table.totalRows ?? table.rows.length;
  const totalColumns = table.totalColumns ?? Math.max(
    table.headers.length,
    table.rows.reduce((largest, row) => Math.max(largest, row.length), 0),
  );
  const headers: string[] = [];
  const rows: string[][] = [];
  let cellsTruncated = false;

  for (const header of table.headers.slice(0, TABLE_PREVIEW_MAX_COLUMNS)) {
    const clipped = truncateString(header, TABLE_PREVIEW_MAX_CELL_BYTES);
    const candidate = [...headers, clipped.value];
    const preview = measuredPreview(
      candidate,
      rows,
      totalRows,
      totalColumns,
      cellsTruncated || clipped.truncated,
    );
    if (preview.serialized_bytes > budgetBytes) break;
    headers.push(clipped.value);
    cellsTruncated ||= clipped.truncated;
  }

  const columnLimit = Math.min(
    headers.length || totalColumns,
    TABLE_PREVIEW_MAX_COLUMNS,
  );
  for (const sourceRow of table.rows.slice(0, TABLE_PREVIEW_MAX_ROWS)) {
    let rowTruncated = false;
    const row = sourceRow.slice(0, columnLimit).map((cell) => {
      const clipped = previewCell(cell);
      rowTruncated ||= clipped.truncated;
      return clipped.value;
    });
    const candidate = [...rows, row];
    const preview = measuredPreview(
      headers,
      candidate,
      totalRows,
      totalColumns,
      cellsTruncated || rowTruncated,
    );
    if (preview.serialized_bytes > budgetBytes) break;
    rows.push(row);
    cellsTruncated ||= rowTruncated;
  }

  const preview = measuredPreview(
    headers,
    rows,
    totalRows,
    totalColumns,
    cellsTruncated,
  );
  return preview.serialized_bytes <= budgetBytes ? preview : undefined;
}
