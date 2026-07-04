/**
 * Renders the inputs and outputs of an analysis as parallel tables.
 *
 * Inputs and outputs are both first-class structural elements; each
 * row is the page's carrier for the corresponding `<kind>-<id>`
 * identifier. Evidence rendering (figures, JSON/CSV tables, pending
 * admonitions) is composed by callers — the per-output carrier
 * exists whether or not any evidence references the output.
 */

import type { Input, Output } from '@astra-spec/sdk';
import {
  table,
  tableRow,
  tableCell,
  text,
  strong,
} from './ast-helpers.js';
import type { ProseParser } from './prose.js';

/**
 * The shared registry-table shape: label / type / description per row.
 *
 * Compact handle: prefer label, fall back to id (added in v0.0.6).
 * Description parses as inline Markdown so emphasis/links/code render
 * inside the table cell. `type` is schema-optional only for aliased
 * elements (those with `from:`); fall back to an empty cell when absent.
 *
 * Each row carries a stable `identifier: <kind>-<id>` so the narrative
 * grammar `[text](#<collection>.<id>)` resolves to it. mdast's `tableRow`
 * doesn't formally have an identifier slot, but the node tolerates extra
 * fields and the xref index keys off `identifier` regardless of node type.
 *
 * This is the xref contract: anything `collectIdentifiers` publishes must
 * have a rendered carrier. Image/JSON/CSV evidence still appears wherever
 * it's structurally referenced (typically under a finding); the row here
 * is the stable anchor target.
 */
function renderRegistryTable(
  kind: 'Input' | 'Output',
  items: Array<Input | Output>,
  prose: ProseParser,
): any {
  const headerRow = tableRow(
    [
      tableCell([text(kind)], true),
      tableCell([text('Type')], true),
      tableCell([text('Description')], true),
    ],
    true,
  );

  const dataRows = items.map((item) => {
    const descCell = prose.inline(item.description);
    const row: any = tableRow([
      tableCell([strong([text(item.label ?? item.id)])]),
      tableCell([text(item.type ?? '')]),
      tableCell(descCell.length > 0 ? descCell : [text('')]),
    ]);
    row.identifier = `${kind.toLowerCase()}-${item.id}`;
    row.label = row.identifier;
    return row;
  });

  return table([headerRow, ...dataRows]);
}

// Callers filter out the empty case so the page doesn't render a stray
// "no inputs" sentence without a section heading to anchor it.

export function renderInputsTable(inputs: Input[], prose: ProseParser): any {
  return renderRegistryTable('Input', inputs, prose);
}

/**
 * Per-output carrier table. Every declared output gets exactly one row keyed
 * by `output-<id>`, regardless of whether the artifact has been produced or
 * any finding references it via evidence.
 */
export function renderOutputsTable(outputs: Output[], prose: ProseParser): any {
  return renderRegistryTable('Output', outputs, prose);
}
