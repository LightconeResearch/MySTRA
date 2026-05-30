/**
 * Renders the inputs and outputs of an analysis as parallel tables.
 *
 * Inputs and outputs are both first-class structural elements; each
 * row is the page's carrier for the corresponding `<kind>-<id>`
 * identifier. Evidence rendering (figures, JSON/CSV tables, pending
 * admonitions) is composed by callers — the per-output carrier
 * exists whether or not any evidence references the output.
 */

import type {
  Input as ASTRAInput,
  Output as ASTRAOutput,
} from '@astra-spec/sdk';
import {
  table,
  tableRow,
  tableCell,
  text,
  strong,
} from './ast-helpers.js';
import type { ProseParser } from './narrative-parser.js';

export function renderInputsTable(inputs: ASTRAInput[], prose: ProseParser): any {
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
  //
  // Each row carries a stable `identifier: input-<id>` so the
  // narrative grammar `[text](#inputs.<id>)` resolves to it. mdast's
  // `tableRow` doesn't formally have an identifier slot, but the
  // node tolerates extra fields and the xref index keys off
  // `identifier` regardless of node type.
  // `type` is schema-optional only for aliased inputs (those with
  // `from:`). Fall back to an empty cell when absent — Phase B's
  // alias-resolution emission will surface the inherited type.
  const dataRows = inputs.map((input) => {
    const descCell = prose.inline(input.description);
    const row: any = tableRow([
      tableCell([strong([text(input.label ?? input.id)])]),
      tableCell([text(input.type ?? '')]),
      tableCell(descCell.length > 0 ? descCell : [text('')]),
    ]);
    row.identifier = `input-${input.id}`;
    row.label = row.identifier;
    return row;
  });

  return table([headerRow, ...dataRows]);
}

/**
 * Per-output carrier table. Every declared output gets exactly one
 * row keyed by `output-<id>`, regardless of whether the artifact
 * has been produced or any finding references it via evidence.
 *
 * This is the xref contract: anything `collectIdentifiers`
 * publishes must have a rendered carrier. Image/JSON/CSV evidence
 * still appears wherever it's structurally referenced (typically
 * under a finding); the row here is the stable anchor target.
 */
export function renderOutputsTable(outputs: ASTRAOutput[], prose: ProseParser): any {
  const headerRow = tableRow(
    [
      tableCell([text('Output')], true),
      tableCell([text('Type')], true),
      tableCell([text('Description')], true),
    ],
    true,
  );

  // `type` is schema-optional only for aliased outputs (those with
  // `from:`); the resolved type lives at the source. Fall back to an
  // empty cell when type is absent — Phase B's resolved-output
  // emission will surface the inherited type once it lands.
  const dataRows = outputs.map((output) => {
    const descCell = prose.inline(output.description);
    const row: any = tableRow([
      tableCell([strong([text(output.label ?? output.id)])]),
      tableCell([text(output.type ?? '')]),
      tableCell(descCell.length > 0 ? descCell : [text('')]),
    ]);
    row.identifier = `output-${output.id}`;
    row.label = row.identifier;
    return row;
  });

  return table([headerRow, ...dataRows]);
}
