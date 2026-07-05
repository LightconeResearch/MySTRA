/**
 * Renders each decision as one `div` carrier bearing the
 * `decision-<id>` identifier, containing the neutral fallback: an h3
 * heading followed by a `details/summary` dropdown with the rationale
 * and option tabs. Nesting the fallback inside the carrier means a
 * rich theme that overrides the carrier replaces the fallback with it
 * — the same pattern the output / prior-insight carriers follow.
 *
 * No grouping, no section headings: tags survive on the carrier's
 * `data.tags` slot and consumers (paper view, dashboard, plugins)
 * compose any grouping or chrome they want on top. MySTRA's job
 * here is to emit addressable per-decision blocks; the renderer
 * has no opinion about how decisions are organised.
 */

import { isConditionMet } from '@astra-spec/sdk';
import type { Decision, Insight, Universe } from '@astra-spec/sdk';
import {
  carrierDiv,
  heading,
  paragraph,
  text,
  strong,
  emphasis,
  details,
  summary,
  tabSet,
  refNode,
} from './ast-helpers.js';
import type { ProseParser } from './prose.js';
import { reportWarn } from '../diagnostics.js';

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

/**
 * The option id a universe selects for a decision, falling back to the
 * decision's declared default. THE "what did the universe pick" rule —
 * every surface (tabs, values, store, provenance) resolves through here.
 */
export function selectedOptionId(
  id: string,
  decision: { default?: string } | undefined,
  universe: { decisions?: Record<string, string> },
): string | undefined {
  return universe.decisions?.[id] ?? decision?.default;
}

/**
 * The "Supporting insight(s): a, b" paragraph of store-driven `astra-ref`
 * tokens for an option's cited prior insights, or `null` when none resolve.
 * Broken references warn through the vfile channel so unresolved insight ids
 * don't silently disappear. Shared by the option tabs and the single-option
 * embed.
 */
export function supportingInsightsParagraph(
  insightIds: string[],
  priorInsights: Record<string, Insight>,
  vfile?: any,
): any | null {
  const refs: any[] = [];
  for (const insightId of insightIds) {
    const insight = priorInsights[insightId];
    if (!insight) {
      reportWarn(
        vfile,
        `Option references unknown prior_insight id "${insightId}" — broken reference dropped from output.`,
      );
      continue;
    }
    const linkText = insight.label ?? insight.claim ?? insightId;
    refs.push(refNode('prior_insight', insightId, insightId, linkText));
  }
  if (refs.length === 0) return null;
  const para: any[] = [text(refs.length === 1 ? 'Supporting insight: ' : 'Supporting insights: ')];
  refs.forEach((ref, i) => {
    if (i > 0) para.push(text(', '));
    para.push(ref);
  });
  return paragraph(para);
}

export function renderDecision(
  id: string,
  decision: Decision,
  priorInsights: Record<string, Insight>,
  universe: Universe,
  prose: ProseParser,
  tabItem: TabItemFn,
  vfile?: any,
): any[] {
  const options = decision.options!;
  const selectedId = selectedOptionId(id, decision, universe);
  const selectedOption = selectedId ? options[selectedId] : undefined;
  const selectedLabel = selectedOption?.label ?? selectedId ?? '(none)';
  const decisionLabel = decision.label ?? id;

  const fallback: any[] = [];

  // h3 heading for the decision (same level as a finding). h3 sits contiguously
  // under a typical `## ` section, where h4 skipped a level (MyST "missing
  // heading depth 3"). The `decision-<id>` identifier lives on the carrier div
  // (below), not here — the heading is part of the neutral fallback.
  fallback.push(heading(3, [text(decisionLabel)]));

  // Build option tabs in declaration order…
  const tabs = Object.entries(options).map(([optionId, option]) =>
    renderOptionTab(optionId, option, optionId === selectedId, priorInsights, prose, tabItem, vfile),
  );
  // …then move the selected tab to first position (book-theme defaults to the
  // first tab). `indexOf` returns -1 when nothing is selected, so the splice
  // is skipped.
  const selectedIndex = Object.keys(options).indexOf(selectedId ?? '');
  if (selectedIndex > 0) tabs.unshift(...tabs.splice(selectedIndex, 1));

  // Build details/summary dropdown (neutral styling, not admonition)
  const detailsChildren: any[] = [
    summary([
      strong([text(decisionLabel)]),
      text(` — selected: ${selectedLabel}`),
    ]),
  ];

  if (decision.rationale) {
    // Rationale parses as full MyST Markdown.
    detailsChildren.push(...prose.blocks(decision.rationale));
  }

  if (tabs.length > 0) {
    detailsChildren.push(tabSet(tabs));
  }

  fallback.push(details(detailsChildren, false));

  // One carrier div holds the whole fallback; identifier follows the
  // structural-element scheme `<kind>-<id>`. Tags ride along on the carrier's
  // mdast `data` slot — surface for downstream consumers that want to group
  // decisions, without imposing any grouping.
  const carrier: any = carrierDiv(fallback, `decision-${id}`);
  if (decision.tags && decision.tags.length > 0) {
    carrier.data = { ...(carrier.data ?? {}), tags: decision.tags };
  }
  return [carrier];
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
  vfile?: any,
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

  // Description as full MyST Markdown.
  if (option.description) {
    children.push(...prose.blocks(option.description));
  }

  // Excluded reason: parsed as author prose.
  // The "Excluded:" prefix is dropped — the boolean `excluded`
  // field already carries that semantics; the prose just explains
  // why. Inline-only because we want the reason to read as a
  // single emphasised line under the option.
  if (option.excluded && option.excluded_reason) {
    children.push(
      paragraph([emphasis(prose.inline(option.excluded_reason))]),
    );
  }

  // Supporting insights — emit store-driven `astra-ref` tokens (the same inline
  // reference the `{astra:prior-insight}` role produces). A rich theme renders
  // each one's card from the resolved store by id; a bare theme shows the label.
  const insightsPara = supportingInsightsParagraph(option.insights ?? [], priorInsights, vfile);
  if (insightsPara) children.push(insightsPara);

  return tabItem(title, children, isSelected);
}
