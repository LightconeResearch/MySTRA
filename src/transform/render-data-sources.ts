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
import { localId } from '../path.js';
import { table, tableRow, tableCell, text, strong } from './ast-helpers.js';
import type { ProseParser } from './prose.js';

/**
 * The shared registry-table shape: label / type / description per row.
 *
 * Compact handle: prefer label, fall back to id.
 * Description parses as inline Markdown so emphasis/links/code render
 * inside the table cell. The resolved SDK contract guarantees `type`.
 *
 * Each row carries a stable `identifier: <kind>-<id>`. mdast's `tableRow`
 * tolerates the extra field, giving stock rendering a local anchor and rich
 * themes a predictable fallback carrier.
 */
function renderRegistryTable(
  kind: 'Input' | 'Output',
  items: readonly (Input | Output)[],
  prose: ProseParser,
): any {
  const headerRow = tableRow(
    [
      tableCell([text(kind)], true),
      tableCell([text(kind === 'Input' ? 'Path' : 'Type')], true),
      tableCell([text('Description')], true),
    ],
    true,
  );

  const dataRows = items.map((item) => {
    const descCell = prose.inline(item.description);
    const row: any = tableRow([
      tableCell([strong([text(item.label ?? localId(item))])]),
      tableCell([text('type' in item ? String(item.type) : item.path)]),
      tableCell(descCell.length > 0 ? descCell : [text('')]),
    ]);
    row.identifier = `${kind.toLowerCase()}-${localId(item)}`;
    row.label = row.identifier;
    return row;
  });

  return table([headerRow, ...dataRows]);
}

// Callers filter out the empty case so the page doesn't render a stray
// "no inputs" sentence without a section heading to anchor it.

export function renderInputsTable(
  inputs: readonly Input[],
  prose: ProseParser,
): any {
  return renderRegistryTable('Input', inputs, prose);
}

/**
 * Per-output carrier table. Every declared output gets exactly one row keyed
 * by `output-<id>`, regardless of whether the artifact has been produced or
 * any finding references it via evidence.
 */
export function renderOutputsTable(
  outputs: readonly Output[],
  prose: ProseParser,
): any {
  return renderRegistryTable('Output', outputs, prose);
}
