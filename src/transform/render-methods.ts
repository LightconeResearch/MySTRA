/**
 * Renders each decision as a flat block: an h4 heading carrying the
 * `decision-<id>` identifier, followed by a `details/summary`
 * dropdown with the rationale and option tabs.
 *
 * No grouping, no section headings: tags survive on the heading's
 * `data.tags` slot and consumers (paper view, dashboard, plugins)
 * compose any grouping or chrome they want on top. MySTRA's job
 * here is to emit addressable per-decision blocks; the renderer
 * has no opinion about how decisions are organised.
 */

import { isConditionMet } from '@astra-spec/sdk';
import type { Decision, Insight, Universe } from '@astra-spec/sdk';
import {
  heading,
  paragraph,
  text,
  strong,
  emphasis,
  details,
  summary,
  tabSet,
  crossReference,
} from './ast-helpers.js';
import type { ProseParser } from './prose.js';

/**
 * tabItem factory bound to the current render pass. Created once per
 * scope (by the plugin) and threaded through to every renderer that
 * mints tab keys, so the counter is per-pass, not global.
 */
export type TabItemFn = (title: string, children: any[], selected?: boolean) => any;

/**
 * Will this decision produce a rendered block on the page?
 *
 * Two reasons a declared decision drops out of the AST:
 *  - it's a bare `from`-reference (no local definition; the
 *    parent analysis is where the data lives)
 *  - its `when` predicate is unmet given the active universe
 *
 * The xref index uses this predicate to publish only ids that have
 * a real carrier — anchors to unrendered decisions would otherwise
 * land on nothing.
 */
export function isDecisionRendered(
  decision: Decision,
  universe: Universe,
): boolean {
  if (decision.from) return false;
  if (!decision.options) return false;
  if (!isConditionMet(decision.when, universe.decisions ?? {})) return false;
  return true;
}

export function renderDecision(
  id: string,
  decision: Decision,
  priorInsights: Record<string, Insight>,
  universe: Universe,
  prose: ProseParser,
  tabItem: TabItemFn,
): any[] {
  const options = decision.options!;
  const selectedOptionId = universe.decisions?.[id] ?? decision.default;
  const selectedOption = selectedOptionId ? options[selectedOptionId] : undefined;
  const selectedLabel = selectedOption?.label ?? selectedOptionId ?? '(none)';
  const decisionLabel = decision.label ?? id;

  const nodes: any[] = [];

  // h4 heading for the decision; identifier follows the
  // structural-element scheme `<kind>-<id>`. Tags ride along on the
  // mdast `data` slot — surface for downstream consumers that want
  // to group decisions, without imposing any grouping ourselves.
  const head: any = heading(4, [text(decisionLabel)], `decision-${id}`);
  if (decision.tags && decision.tags.length > 0) {
    head.data = { ...(head.data ?? {}), tags: decision.tags };
  }
  nodes.push(head);

  // Build option tabs, tracking which is selected for reordering
  const tabs: any[] = [];
  let selectedIndex = -1;
  const optionEntries = Object.entries(options);
  for (let i = 0; i < optionEntries.length; i++) {
    const [optionId, option] = optionEntries[i];
    const isSelected = optionId === selectedOptionId;
    if (isSelected) selectedIndex = i;
    tabs.push(renderOptionTab(optionId, option, isSelected, priorInsights, prose, tabItem));
  }

  // Move selected tab to first position (book-theme defaults to first tab)
  if (selectedIndex > 0) {
    const [selected] = tabs.splice(selectedIndex, 1);
    tabs.unshift(selected);
  }

  // Build details/summary dropdown (neutral styling, not admonition)
  const detailsChildren: any[] = [
    summary([
      strong([text(decisionLabel)]),
      text(` — selected: ${selectedLabel}`),
    ]),
  ];

  if (decision.rationale) {
    // Rationale parses as full Markdown with anchor resolution —
    // narrative-grammar links inside rationales resolve to
    // crossReferences against the host analysis.
    detailsChildren.push(...prose.blocks(decision.rationale));
  }

  if (tabs.length > 0) {
    detailsChildren.push(tabSet(tabs));
  }

  nodes.push(details(detailsChildren, false));

  return nodes;
}

function renderOptionTab(
  optionId: string,
  option: {
    label: string;
    description?: string;
    insights?: string[];
    excluded?: boolean;
    excluded_reason?: string;
  },
  isSelected: boolean,
  priorInsights: Record<string, Insight>,
  prose: ProseParser,
  tabItem: TabItemFn,
): any {
  // Tab title with selection marker
  let marker: string;
  if (option.excluded) {
    marker = ' ✕';
  } else if (isSelected) {
    marker = ' ●';
  } else {
    marker = ' ○';
  }
  const title = `${option.label}${marker}`;

  const children: any[] = [];

  // Description as full Markdown with anchor resolution.
  if (option.description) {
    children.push(...prose.blocks(option.description));
  }

  // Excluded reason: parsed as author prose with anchor resolution.
  // The "Excluded:" prefix is dropped — the boolean `excluded`
  // field already carries that semantics; the prose just explains
  // why. Inline-only because we want the reason to read as a
  // single emphasised line under the option.
  if (option.excluded && option.excluded_reason) {
    children.push(
      paragraph([emphasis(prose.inline(option.excluded_reason))]),
    );
  }

  // Supporting insights — emit crossReferences to the flat
  // prior_insight blocks rendered elsewhere on the page. The flat
  // block is the source of truth; the option tab only points at it
  // (no inline expansion). Broken references emit a console.warn
  // so unresolved insight ids don't silently disappear.
  if (option.insights && option.insights.length > 0) {
    const refs: any[] = [];
    for (const insightId of option.insights) {
      const insight = priorInsights[insightId];
      if (!insight) {
        console.warn(
          `[mystra] Option references unknown prior_insight id "${insightId}" — broken reference dropped from output.`,
        );
        continue;
      }
      const linkText = insight.label ?? insight.claim ?? insightId;
      refs.push(crossReference(`prior_insight-${insightId}`, [text(linkText)]));
    }
    if (refs.length > 0) {
      const count = refs.length;
      const label = count === 1 ? 'Supporting insight: ' : 'Supporting insights: ';
      const para: any[] = [text(label)];
      for (let i = 0; i < refs.length; i++) {
        if (i > 0) para.push(text(', '));
        para.push(refs[i]);
      }
      children.push(paragraph(para));
    }
  }

  return tabItem(title, children, isSelected);
}
