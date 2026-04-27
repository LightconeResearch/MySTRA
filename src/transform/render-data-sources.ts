/**
 * Renders the Data Sources section as an inputs table.
 */

import type { ASTRAInput } from '../types/astra.js';
import {
  table,
  tableRow,
  tableCell,
  text,
  strong,
} from './ast-helpers.js';
import { parseProseInline } from './narrative-parser.js';

export function renderInputsTable(inputs: ASTRAInput[]): any {
  // Caller filters out the empty case so the page doesn't render a
  // stray "no inputs" sentence without a section heading to anchor it.

  const headerRow = tableRow(
    [
      tableCell([text('Input')], true),
      tableCell([text('Type')], true),
      tableCell([text('Description')], true),
    ],
    true,
  );

  // Compact handle: prefer label, fall back to id (added in v0.0.6).
  // Description parses as inline Markdown so emphasis/links/code
  // render inside the table cell.
  const dataRows = inputs.map((input) => {
    const descCell = parseProseInline(input.description);
    return tableRow([
      tableCell([strong([text(input.label ?? input.id)])]),
      tableCell([text(input.type)]),
      tableCell(descCell.length > 0 ? descCell : [text('')]),
    ]);
  });

  return table([headerRow, ...dataRows]);
}
