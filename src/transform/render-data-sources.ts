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
  const dataRows = inputs.map((input) =>
    tableRow([
      tableCell([strong([text(input.label ?? input.id)])]),
      tableCell([text(input.type)]),
      tableCell([text(input.description ?? '')]),
    ]),
  );

  return table([headerRow, ...dataRows]);
}
