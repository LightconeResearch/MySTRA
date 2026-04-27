/**
 * Renders prior_insights as flat per-insight blocks: an h3 heading
 * carrying `prior_insight-<id>` (the xref-contract carrier), the
 * insight's claim parsed as prose, scope where present, and the
 * evidence body. Mirrors the shape of `render-findings.ts` — both
 * are addressable, flat, and described by Insight in astra-spec.
 *
 * Why flat blocks (not inline-only-when-referenced):
 *   collectIdentifiers publishes `prior_insight-<id>` for every
 *   declared prior_insight. The xref contract is "every published id
 *   has a rendered carrier". When prior_insights only existed inline
 *   inside option tabs, references from outside any option tab
 *   landed on nothing — and prior_insights without any option-tab
 *   reference had no carrier at all. Flat blocks fix both.
 *
 *   Option tabs now emit a crossReference back to this flat block
 *   instead of expanding the insight inline. The flat block is the
 *   source of truth.
 */

import type { ASTRAInsight } from '../types/astra.js';
import {
  heading,
  paragraph,
  text,
  emphasis,
  thematicBreak,
} from './ast-helpers.js';
import { renderInsightEvidence } from './render-evidence.js';
import type { ProseParser } from './narrative-parser.js';

export function renderPriorInsights(
  priorInsights: Record<string, ASTRAInsight>,
  prose: ProseParser,
  doiCacheDir: string | null,
): any[] {
  const entries = Object.entries(priorInsights);
  if (entries.length === 0) return [];

  const nodes: any[] = [];
  let first = true;

  for (const [insightId, insight] of entries) {
    if (!first) nodes.push(thematicBreak());
    first = false;
    nodes.push(...renderPriorInsight(insightId, insight, prose, doiCacheDir));
  }

  return nodes;
}

function renderPriorInsight(
  insightId: string,
  insight: ASTRAInsight,
  prose: ProseParser,
  doiCacheDir: string | null,
): any[] {
  const nodes: any[] = [];
  const identifier = `prior_insight-${insightId}`;

  // h3 heading carrying the carrier identifier; claim parses as
  // inline Markdown (emphasis/code/anchors all resolve).
  const labelText = insight.label ? `${insight.label}: ` : '';
  const headlineChildren = labelText
    ? [text(labelText), ...prose.inline(insight.claim)]
    : prose.inline(insight.claim);
  nodes.push(heading(3, headlineChildren, identifier));

  // Scope (mirrors findings' rendering of the same field).
  if (insight.scope) {
    nodes.push(paragraph([emphasis([text(`Scope: ${insight.scope}`)])]));
  }

  // Evidence body — quotes, citations, artifact references.
  nodes.push(...renderInsightEvidence(insight, doiCacheDir));

  return nodes;
}
