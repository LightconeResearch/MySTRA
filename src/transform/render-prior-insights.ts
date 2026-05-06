/**
 * Renders prior_insights as minimal addressable carriers.
 *
 * Each prior_insight emits as a single `container` node with kind
 * `prior-insight`, identifier `prior_insight-<id>`, structured
 * `data` for downstream renderers, and children = [claim paragraph,
 * …evidence body]. No heading, no thematic-break separators, no
 * `'Scope:'` label paragraph — surfacing prior_insights as a visible
 * "section" is a renderer's call (sidebar, hover, hidden, h3, …),
 * not the transform's. The transform's job is to publish a stable
 * carrier so option-tab crossReferences and narrative anchors
 * resolve to *something* on the page.
 *
 * Asymmetric with findings on purpose: findings are paper-headline
 * material by convention, so they keep their h3 + paragraph shape.
 * Prior insights are typically supporting context; how to display
 * them is downstream's call.
 *
 * Why `kind: 'prior-insight'` and not `'prior_insight'`: MyST AST
 * `container.kind` is conventionally a kebab-case CSS-class-like
 * identifier (`figure`, `seealso`, `tip`); the underscore form
 * survives in the structural identifier (`prior_insight-<id>`),
 * matching the rest of the v0.0.6 anchor grammar. The two
 * conventions live next to each other on the same node.
 */

import type { ASTRAInsight } from '../types/astra.js';
import { paragraph } from './ast-helpers.js';
import { renderInsightEvidence } from './render-evidence.js';
import type { ProseParser } from './narrative-parser.js';

export function renderPriorInsights(
  priorInsights: Record<string, ASTRAInsight>,
  prose: ProseParser,
  doiCacheDir: string | null,
): any[] {
  return Object.entries(priorInsights).map(([id, insight]) =>
    renderPriorInsight(id, insight, prose, doiCacheDir),
  );
}

function renderPriorInsight(
  insightId: string,
  insight: ASTRAInsight,
  prose: ProseParser,
  doiCacheDir: string | null,
): any {
  const identifier = `prior_insight-${insightId}`;
  return {
    type: 'container',
    kind: 'prior-insight',
    identifier,
    label: identifier,
    class: 'astra astra-prior-insight',
    data: {
      astraKind: 'prior_insight',
      id: insightId,
      label: insight.label ?? null,
      scope: insight.scope ?? null,
      tags: insight.tags ?? null,
      derived: insight.derived ?? false,
    },
    children: [
      paragraph(prose.inline(insight.claim)),
      ...renderInsightEvidence(insight, doiCacheDir),
    ],
  };
}
