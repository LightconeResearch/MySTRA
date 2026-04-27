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

import type { ASTRADecision, ASTRAInsight, ASTRAUniverse } from '../types/astra.js';
import {
  heading,
  paragraph,
  text,
  strong,
  emphasis,
  details,
  summary,
  tabSet,
  thematicBreak,
} from './ast-helpers.js';
import { renderInsight } from './render-evidence.js';
import type { ProseParser } from './narrative-parser.js';

/**
 * tabItem factory bound to the current transform pass. Created once
 * by astraToMystAST and threaded through to every renderer that
 * mints tab keys, so the counter is per-transform, not global.
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
  decision: ASTRADecision,
  universe: ASTRAUniverse,
): boolean {
  if (decision.from) return false;
  if (!decision.options) return false;
  if (!isConditionMet(decision.when, universe)) return false;
  return true;
}

export function renderMethodsSections(
  decisions: Record<string, ASTRADecision>,
  priorInsights: Record<string, ASTRAInsight>,
  universe: ASTRAUniverse,
  prose: ProseParser,
  tabItem: TabItemFn,
): any[] {
  const nodes: any[] = [];
  const entries = Object.entries(decisions).filter(([, d]) =>
    isDecisionRendered(d, universe),
  );

  for (let i = 0; i < entries.length; i++) {
    const [id, decision] = entries[i];
    nodes.push(...renderDecision(id, decision, priorInsights, universe, prose, tabItem));
    // Thematic break between decisions (not after the last one).
    if (i < entries.length - 1) {
      nodes.push(thematicBreak());
    }
  }

  return nodes;
}

function renderDecision(
  id: string,
  decision: ASTRADecision,
  priorInsights: Record<string, ASTRAInsight>,
  universe: ASTRAUniverse,
  prose: ProseParser,
  tabItem: TabItemFn,
): any[] {
  const options = decision.options!;
  const selectedOptionId = universe.decisions[id] ?? decision.default;
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
  priorInsights: Record<string, ASTRAInsight>,
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

  // Supporting insights — collapsible dropdown
  if (option.insights && option.insights.length > 0) {
    const insightNodes: any[] = [];

    for (const insightId of option.insights) {
      insightNodes.push(...renderInsight(insightId, priorInsights, prose));
    }

    const count = option.insights.length;
    const label = count === 1 ? 'Supporting insight' : `Supporting insights (${count})`;
    children.push(details([summary([text(label)]), ...insightNodes], false));
  }

  return tabItem(title, children, isSelected);
}

/**
 * Check if a `when` condition is satisfied by the universe. `when` is
 * multivalued in astra-spec — multiple conditions are AND'd together.
 */
function isConditionMet(
  when: string[] | undefined,
  universe: ASTRAUniverse,
): boolean {
  if (when === undefined) return true;

  for (const cond of when) {
    const negated = cond.startsWith('~');
    const ref = negated ? cond.slice(1) : cond;
    const dotIndex = ref.indexOf('.');
    if (dotIndex === -1) continue;

    const decisionId = ref.slice(0, dotIndex);
    const optionId = ref.slice(dotIndex + 1);
    const selected = universe.decisions[decisionId];

    if (negated) {
      if (selected === optionId) return false;
    } else {
      if (selected !== optionId) return false;
    }
  }

  return true;
}
