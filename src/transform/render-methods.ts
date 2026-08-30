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

import type {
  ResolvedDecision,
  ResolvedInsight,
  ResolvedRecord,
  ResolvedOption,
} from '@astra-spec/sdk';
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

/**
 * tabItem factory bound to the current render pass. Created once per
 * scope (by the plugin) and threaded through to every renderer that
 * mints tab keys, so the counter is per-pass, not global.
 */
export type TabItemFn = (title: string, children: any[], selected?: boolean) => any;

/**
 * Will this decision produce a rendered block on the page?
 *
 * A decision drops out only when its `when` predicate is unmet under the
 * active universe. The SDK has already resolved `from` references into a
 * complete record, so renderers do not special-case their authored origin.
 *
 * Inactive decisions have no carrier and are reported explicitly when an
 * author addresses them.
 */
export function isDecisionRendered(
  decision: ResolvedDecision,
): boolean {
  return decision.active && decision.options.length > 0;
}

/**
 * The "Supporting insight(s): a, b" paragraph of SDK-backed `astra-ref`
 * tokens for an option's cited prior insights, or `null` when none resolve.
 * The SDK has already validated and resolved every path. Shared by the option
 * tabs and the single-option embed.
 */
export function supportingInsightsParagraph(
  insightPaths: string[],
  records: ReadonlyMap<string, ResolvedRecord>,
): any | null {
  const refs: any[] = [];
  for (const canonicalPath of insightPaths) {
    const insight = records.get(canonicalPath) as ResolvedInsight;
    const linkText = insight.label ?? insight.claim ?? insight.id;
    refs.push(refNode('prior_insight', insight.id, linkText, undefined, { canonicalPath }));
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
  decision: ResolvedDecision,
  records: ReadonlyMap<string, ResolvedRecord>,
  prose: ProseParser,
  tabItem: TabItemFn,
): any[] {
  const options = decision.options;
  const selectedId = decision.selectedOptionId;
  const selectedOption = selectedId
    ? options.find((option) => option.id === selectedId)
    : undefined;
  const selectedLabel = selectedOption?.label ?? selectedId ?? '(none)';
  const decisionLabel = decision.label ?? id;

  const fallback: any[] = [];

  // h3 heading for the decision (same level as a finding). h3 sits contiguously
  // under a typical `## ` section, where h4 skipped a level (MyST "missing
  // heading depth 3"). The `decision-<id>` identifier lives on the carrier div
  // (below), not here — the heading is part of the neutral fallback.
  fallback.push(heading(3, [text(decisionLabel)]));

  // Build option tabs in declaration order…
  const tabs = options.map((option) =>
    renderOptionTab(option, option.id === selectedId, records, prose, tabItem),
  );
  // …then move the selected tab to first position (book-theme defaults to the
  // first tab). `indexOf` returns -1 when nothing is selected, so the splice
  // is skipped.
  const selectedIndex = options.findIndex((option) => option.id === selectedId);
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
    detailsChildren.push(...prose.blocks(decision.rationale, 4));
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
  option: ResolvedOption,
  isSelected: boolean,
  records: ReadonlyMap<string, ResolvedRecord>,
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

  // Description as full MyST Markdown.
  if (option.description) {
    children.push(...prose.blocks(option.description, 4));
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

  // Supporting insights use the same canonical-path `astra-ref` token as the
  // authoring role. Rich themes can open the shared record UI; bare themes show
  // the label.
  const insightsPara = supportingInsightsParagraph(
    option.resolvedInsightPaths,
    records,
  );
  if (insightsPara) children.push(insightsPara);

  return tabItem(title, children, isSelected);
}
