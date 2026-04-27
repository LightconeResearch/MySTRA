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
  paragraph,
  emphasis,
} from './ast-helpers.js';
import { parseProseInline } from './narrative-parser.js';

export function renderVerification(
  criteria: ASTRASuccessCriterion[],
  results: Map<string, string>,
): any {
  if (criteria.length === 0) {
    return paragraph([emphasis([text('No success criteria defined.')])]);
  }

  const headerRow = tableRow(
    [
      tableCell([text('Status')], true),
      tableCell([text('Claim')], true),
      tableCell([text('Evidence')], true),
    ],
    true,
  );

  const dataRows = criteria.map((criterion) => {
    const produced = criterion.output ? results.has(criterion.output) : false;
    const status = produced ? '\u2705' : '\u23F3';

    const claimCell = parseProseInline(criterion.claim);
    return tableRow([
      tableCell([text(status)]),
      tableCell(claimCell.length > 0 ? claimCell : [text('')]),
      tableCell(criterion.output ? [inlineCode(criterion.output)] : [text('\u2014')]),
    ]);
  });

  return table([headerRow, ...dataRows]);
}
