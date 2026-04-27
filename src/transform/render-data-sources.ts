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
  paragraph,
  emphasis,
} from './ast-helpers.js';
import { parseProseInline } from './narrative-parser.js';

export function renderInputsTable(inputs: ASTRAInput[]): any {
  if (inputs.length === 0) {
    return paragraph([emphasis([text('No inputs declared.')])]);
  }

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
