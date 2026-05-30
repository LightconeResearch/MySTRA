/**
 * Renders the universe banner showing which analysis path is active.
 * Collapsible details with a table of decision → selected option.
 */

import type {
  Decision as ASTRADecision,
  Universe as ASTRAUniverse,
} from '@astra-spec/sdk';
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
import type { ProseParser } from './narrative-parser.js';

export function renderUniverseBanner(
  universe: ASTRAUniverse,
  decisions: Record<string, ASTRADecision>,
  prose: ProseParser,
): any {
  const rows: any[] = [];

  for (const [decisionId, selectedOptionId] of Object.entries(universe.decisions ?? {})) {
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

  // Universe.description gets the same anchor-resolution treatment
  // as other prose fields. Inline-only because the banner's
  // collapsible summary expects a single line of phrasing content.
  const descNodes = prose.inline(universe.description);

  return details(
    [
      summary([
        text('Universe: '),
        strong([text(universe.id)]),
        ...(descNodes.length > 0
          ? [text(' — '), ...descNodes]
          : []),
      ]),
      ...(rows.length > 0 ? [table([headerRow, ...rows])] : []),
    ],
    true,
  );
}
