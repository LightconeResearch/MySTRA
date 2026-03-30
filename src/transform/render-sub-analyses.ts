/**
 * Renders sub-analysis cards linking to child pages.
 */

import type { ASTRAAnalysis } from '../types/astra.js';
import { card, paragraph, text } from './ast-helpers.js';

export function renderSubAnalysisCards(
  analyses: Record<string, ASTRAAnalysis>,
): any[] {
  const nodes: any[] = [];

  for (const [id, sub] of Object.entries(analyses)) {
    const decisionCount = Object.keys(sub.decisions ?? {}).length;
    const inputCount = sub.inputs?.length ?? 0;
    const outputCount = sub.outputs?.length ?? 0;

    const children: any[] = [];

    if (sub.description) {
      children.push(paragraph([text(sub.description)]));
    }

    children.push(
      paragraph([
        text(`${decisionCount} decisions · ${inputCount} inputs · ${outputCount} outputs`),
      ]),
    );

    nodes.push(card(sub.name ?? id, children, `/${id}`));
  }

  return nodes;
}
