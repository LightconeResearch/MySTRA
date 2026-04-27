/**
 * Renders the Verification section: a table of success criteria
 * with status derived from whether outputs have been produced.
 */

import type { ASTRASuccessCriterion } from '../types/astra.js';
import {
  table,
  tableRow,
  tableCell,
  text,
  inlineCode,
} from './ast-helpers.js';
import { parseProseInline } from './narrative-parser.js';

export function renderVerification(
  criteria: ASTRASuccessCriterion[],
  results: Map<string, string>,
): any {
  // Caller filters out the empty case so the page doesn't render a
  // stray "no criteria" sentence without a section heading.

  const headerRow = tableRow(
    [
      tableCell([text('Status')], true),
      tableCell([text('Claim')], true),
      tableCell([text('Evidence')], true),
    ],
    true,
  );

  // Success criteria don't have IDs in the spec; key by referenced
  // output if any, else by index. Each row carries
  // `identifier: verification-<id>` for cross-references.
  const dataRows = criteria.map((criterion, i) => {
    const produced = criterion.output ? results.has(criterion.output) : false;
    const status = produced ? '✅' : '⏳';

    const claimCell = parseProseInline(criterion.claim);
    const id = criterion.output ?? String(i);
    const row: any = tableRow([
      tableCell([text(status)]),
      tableCell(claimCell.length > 0 ? claimCell : [text('')]),
      tableCell(criterion.output ? [inlineCode(criterion.output)] : [text('—')]),
    ]);
    row.identifier = `verification-${id}`;
    row.label = row.identifier;
    return row;
  });

  return table([headerRow, ...dataRows]);
}
