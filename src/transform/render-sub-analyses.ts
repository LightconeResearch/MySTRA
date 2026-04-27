/**
 * Renders sub-analysis cards linking to child pages.
 */

import type { ASTRAAnalysis } from '../types/astra.js';
import { card, paragraph, text } from './ast-helpers.js';
import { renderNarrativeSection } from './render-narrative.js';

export function renderSubAnalysisCards(
  analyses: Record<string, ASTRAAnalysis>,
  hostSlug: string,
): any[] {
  const nodes: any[] = [];

  for (const [id, sub] of Object.entries(analyses)) {
    const decisionCount = Object.keys(sub.decisions ?? {}).length;
    const inputCount = sub.inputs?.length ?? 0;
    const outputCount = sub.outputs?.length ?? 0;

    // Sub-analysis preview comes from its own narrative summary;
    // anchors in that summary resolve relative to the sub-analysis,
    // not the parent — so use the sub's own slug for resolution.
    const subSlug = hostSlug === 'index' ? id : `${hostSlug}/${id}`;

    const children: any[] = [
      ...renderNarrativeSection(sub.narrative?.summary, sub, subSlug),
      paragraph([
        text(`${decisionCount} decisions · ${inputCount} inputs · ${outputCount} outputs`),
      ]),
    ];

    nodes.push(card(sub.name ?? id, children, `/${id}`));
  }

  return nodes;
}
