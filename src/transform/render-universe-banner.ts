/**
 * Renders the universe banner showing which analysis path is active.
 * Collapsible details with a table of decision → selected option.
 */

import type { ASTRAUniverse, ASTRADecision } from '../types/astra.js';
import {
  details,
  summary,
  crossReference,
  strong,
  text,
  table,
  tableRow,
  tableCell,
} from './ast-helpers.js';

export function renderUniverseBanner(
  universe: ASTRAUniverse,
  decisions: Record<string, ASTRADecision>,
): any {
  const rows: any[] = [];

  for (const [decisionId, selectedOptionId] of Object.entries(universe.decisions)) {
    const decision = decisions[decisionId];
    if (!decision?.options) continue;

    const decisionLabel = decision.label ?? decisionId;
    const option = decision.options[selectedOptionId];
    const optionLabel = option?.label ?? selectedOptionId;

    rows.push(
      tableRow([
        tableCell([crossReference(`decision-${decisionId}`, [strong([text(decisionLabel)])])]),
        tableCell([text(optionLabel)]),
      ]),
    );
  }

  const headerRow = tableRow(
    [
      tableCell([text('Decision')], true),
      tableCell([text('Selected')], true),
    ],
    true,
  );

  return details(
    [
      summary([text('Universe: '), strong([text(universe.id)])]),
      ...(rows.length > 0 ? [table([headerRow, ...rows])] : []),
    ],
    true,
  );
}
