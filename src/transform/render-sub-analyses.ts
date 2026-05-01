/**
 * Renders sub-analysis cards linking to child pages.
 *
 * Card content is the sub-analysis's narrative summary — author
 * prose. The renderer doesn't synthesise stat strings ("N decisions
 * · M inputs · K outputs"); that's narrating structural data the
 * destination page already exposes.
 */

import type { ASTRAAnalysis } from '../types/astra.js';
import { card } from './ast-helpers.js';
import { renderNarrativeSection } from './render-narrative.js';
import type { AnalysisScope, PriorInsightScope } from './narrative-parser.js';

export interface SubAnalysisCardContext {
  priorInsightScopes?: PriorInsightScope[];
  analysisScopes?: AnalysisScope[];
  results?: Map<string, string>;
}

export function renderSubAnalysisCards(
  analyses: Record<string, ASTRAAnalysis>,
  hostSlug: string,
  context: SubAnalysisCardContext = {},
): any[] {
  const nodes: any[] = [];

  for (const [id, sub] of Object.entries(analyses)) {
    // Sub-analysis preview comes from its own narrative summary;
    // anchors in that summary resolve relative to the sub-analysis,
    // not the parent — so use the sub's own slug for resolution.
    const subSlug = hostSlug === 'index' ? id : `${hostSlug}/${id}`;
    // Recursive page builder lives the sub-analysis at this URL,
    // so the card link must agree — `/${id}` was wrong for any
    // nested case (parent slug `foo` → sub at `/foo/${id}`, not
    // `/${id}`).
    const cardUrl = `/${subSlug}`;

    const children: any[] = renderNarrativeSection(
      sub.narrative?.summary,
      sub,
      subSlug,
      {
        analysis: sub,
        slug: subSlug,
        priorInsightScopes: context.priorInsightScopes,
        analysisScopes: context.analysisScopes,
        results: context.results,
      },
    );

    // Card carries `identifier: analysis-<id>` so a parent-page
    // anchor link to this card resolves; cross-page narrative refs
    // (`#analyses.<id>`) still resolve to the sub-analysis URL via
    // the resolver, since pages can also be addressed by route.
    const cardNode: any = card(sub.name ?? id, children, cardUrl);
    cardNode.identifier = `analysis-${id}`;
    cardNode.label = cardNode.identifier;
    nodes.push(cardNode);
  }

  return nodes;
}
