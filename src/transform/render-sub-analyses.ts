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

    // Card carries `identifier: analysis-<id>` so a parent-page
    // anchor link to this card resolves; cross-page narrative refs
    // (`#analyses.<id>`) still resolve to the sub-analysis URL via
    // the resolver, since pages can also be addressed by route.
    const cardNode: any = card(sub.name ?? id, children, `/${id}`);
    cardNode.identifier = `analysis-${id}`;
    cardNode.label = cardNode.identifier;
    nodes.push(cardNode);
  }

  return nodes;
}
