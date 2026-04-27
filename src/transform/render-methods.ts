/**
 * Renders the Methods section: decisions grouped by tag, each with
 * an h4 heading and collapsible dropdown containing option tabs.
 *
 * Matches the prototype style from index.md.
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
  tabItem,
  thematicBreak,
} from './ast-helpers.js';
import { groupDecisionsByTag } from './tag-sections.js';
import { renderInsight } from './render-evidence.js';
import type { ProseParser } from './narrative-parser.js';

export function renderMethodsSections(
  decisions: Record<string, ASTRADecision>,
  priorInsights: Record<string, ASTRAInsight>,
  universe: ASTRAUniverse,
  prose: ProseParser,
): any[] {
  const groups = groupDecisionsByTag(decisions);
  const nodes: any[] = [];

  for (const group of groups) {
    // Section heading (h3)
    nodes.push(heading(3, [text(group.sectionLabel)], group.sectionId));

    // Each decision in this group
    for (let i = 0; i < group.decisions.length; i++) {
      const { id, decision } = group.decisions[i];
      nodes.push(...renderDecision(id, decision, priorInsights, universe, prose));

      // Thematic break between decisions (not after the last one)
      if (i < group.decisions.length - 1) {
        nodes.push(thematicBreak());
      }
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
): any[] {
  // Skip if conditional and condition not met
  if (!isConditionMet(decision.when, universe)) {
    return [];
  }

  const options = decision.options;
  if (!options) return [];

  const selectedOptionId = universe.decisions[id] ?? decision.default;
  const selectedOption = selectedOptionId ? options[selectedOptionId] : undefined;
  const selectedLabel = selectedOption?.label ?? selectedOptionId ?? '(none)';
  const decisionLabel = decision.label ?? id;

  const nodes: any[] = [];

  // h4 heading for the decision; identifier follows the
  // structural-element scheme `<kind>-<id>`.
  nodes.push(heading(4, [text(decisionLabel)], `decision-${id}`));

  // Build option tabs, tracking which is selected for reordering
  const tabs: any[] = [];
  let selectedIndex = -1;
  const optionEntries = Object.entries(options);
  for (let i = 0; i < optionEntries.length; i++) {
    const [optionId, option] = optionEntries[i];
    const isSelected = optionId === selectedOptionId;
    if (isSelected) selectedIndex = i;
    tabs.push(renderOptionTab(optionId, option, isSelected, priorInsights, prose));
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

  // Excluded reason
  if (option.excluded && option.excluded_reason) {
    children.push(
      paragraph([emphasis([text(`Excluded: ${option.excluded_reason}`)])]),
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
 * Check if a `when` condition is satisfied by the universe.
 */
function isConditionMet(
  when: string | string[] | undefined,
  universe: ASTRAUniverse,
): boolean {
  if (when === undefined) return true;

  const conditions = Array.isArray(when) ? when : [when];

  for (const cond of conditions) {
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
