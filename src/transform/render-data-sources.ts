/**
 * Renders the Data Sources section as an inputs table.
 */

import type { ASTRAInput } from '../types/astra.js';
import {
  table,
  tableRow,
  tableCell,
  text,
  inlineCode,
  paragraph,
  emphasis,
} from './ast-helpers.js';

export function renderInputsTable(inputs: ASTRAInput[]): any {
  if (inputs.length === 0) {
    return paragraph([emphasis([text('No inputs declared.')])]);
  }

  const headerRow = tableRow(
    [
      tableCell([text('ID')], true),
      tableCell([text('Type')], true),
      tableCell([text('Source')], true),
      tableCell([text('Description')], true),
    ],
    true,
  );

  const dataRows = inputs.map((input) => {
    const sourceContent: any[] = [];
    if (input.source) {
      sourceContent.push(text(input.source));
    } else if (input.ref) {
      sourceContent.push(text(input.ref));
      if (input.ref_version) {
        sourceContent.push(text(` (${input.ref_version})`));
      }
    } else if (input.from) {
      sourceContent.push(text(`from: ${input.from}`));
    } else {
      sourceContent.push(text('—'));
    }

    return tableRow([
      tableCell([inlineCode(input.id)]),
      tableCell([text(input.type)]),
      tableCell(sourceContent),
      tableCell([text(input.description ?? '')]),
    ]);
  });

  return table([headerRow, ...dataRows]);
}
