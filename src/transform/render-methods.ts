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
  admonition,
  admonitionTitle,
  tabSet,
  tabItem,
  thematicBreak,
} from './ast-helpers.js';
import { groupDecisionsByTag } from './tag-sections.js';
import { renderInsightEvidence } from './render-evidence.js';

export function renderMethodsSections(
  decisions: Record<string, ASTRADecision>,
  priorInsights: Record<string, ASTRAInsight>,
  universe: ASTRAUniverse,
): any[] {
  const groups = groupDecisionsByTag(decisions);
  const nodes: any[] = [];

  // Intro paragraph
  nodes.push(
    paragraph([
      text(
        'The following sections detail each methodological decision. ' +
        'Decisions are organized by scientific concern. Each decision shows the selected option ' +
        'with supporting evidence; alternative options can be explored via tabs.',
      ),
    ]),
  );

  for (const group of groups) {
    // Section heading (h3)
    nodes.push(heading(3, [text(group.sectionLabel)], group.sectionId));

    // Each decision in this group
    for (let i = 0; i < group.decisions.length; i++) {
      const { id, decision } = group.decisions[i];
      nodes.push(...renderDecision(id, decision, priorInsights, universe));

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

  // h4 heading for the decision
  nodes.push(heading(4, [text(decisionLabel)], id));

  // Dropdown containing rationale + option tabs
  const dropdownChildren: any[] = [
    admonitionTitle([
      strong([text(decisionLabel)]),
      text(` — selected: ${selectedLabel}`),
    ]),
  ];

  // Rationale
  if (decision.rationale) {
    dropdownChildren.push(paragraph([text(decision.rationale)]));
  }

  // Tab set of options
  const tabs: any[] = [];
  for (const [optionId, option] of Object.entries(options)) {
    const isSelected = optionId === selectedOptionId;
    tabs.push(renderOptionTab(optionId, option, isSelected, priorInsights));
  }

  if (tabs.length > 0) {
    dropdownChildren.push(tabSet(tabs));
  }

  nodes.push(admonition('note', dropdownChildren, { open: false, class: 'dropdown' }));

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

  // Description
  if (option.description) {
    children.push(paragraph([text(option.description)]));
  }

  // Excluded reason
  if (option.excluded && option.excluded_reason) {
    children.push(
      paragraph([emphasis([text(`Excluded: ${option.excluded_reason}`)])]),
    );
  }

  // Evidence from linked insights — collapsible dropdown
  if (option.insights && option.insights.length > 0) {
    const evidenceNodes: any[] = [
      admonitionTitle([text('Evidence')]),
    ];

    for (const insightId of option.insights) {
      evidenceNodes.push(...renderInsightEvidence(insightId, priorInsights));
    }

    children.push(admonition('note', evidenceNodes, { open: false, class: 'dropdown' }));
  }

  return tabItem(title, children);
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
