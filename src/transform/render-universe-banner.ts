/**
 * Renders the universe banner showing which analysis path is active.
 */

import type { ASTRAUniverse, ASTRADecision } from '../types/astra.js';
import {
  admonition,
  admonitionTitle,
  paragraph,
  text,
  strong,
} from './ast-helpers.js';

export function renderUniverseBanner(
  universe: ASTRAUniverse,
  decisions: Record<string, ASTRADecision>,
): any {
  const children: any[] = [
    admonitionTitle([text(`Universe: ${universe.id}`)]),
  ];

  if (universe.description) {
    children.push(paragraph([text(universe.description)]));
  }

  // Build a compact summary of decision selections
  const selections: any[] = [];
  for (const [decisionId, selectedOptionId] of Object.entries(universe.decisions)) {
    const decision = decisions[decisionId];
    if (!decision?.options) continue;

    const decisionLabel = decision.label ?? decisionId;
    const option = decision.options[selectedOptionId];
    const optionLabel = option?.label ?? selectedOptionId;

    if (selections.length > 0) {
      selections.push(text(' · '));
    }
    selections.push(strong([text(decisionLabel)]));
    selections.push(text(`: ${optionLabel}`));
  }

  if (selections.length > 0) {
    children.push(paragraph(selections));
  }

  return admonition('tip', children);
}
