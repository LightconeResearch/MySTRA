/**
 * Renders the Findings section of an analysis page.
 *
 * Matches the prototype style: heading, narrative, figure, result table
 * in dropdown, methodology callout, thematic breaks between findings.
 */

import type { ASTRAInsight, ASTRADecision, ASTRAOutput } from '../types/astra.js';
import {
  heading,
  paragraph,
  text,
  emphasis,
  admonition,
  admonitionTitle,
  crossReference,
  thematicBreak,
} from './ast-helpers.js';
import type { ProseParser } from './narrative-parser.js';
import { renderEvidenceBlock } from './render-evidence.js';

export function renderFindings(
  findings: Record<string, ASTRAInsight>,
  results: Map<string, string>,
  decisions: Record<string, ASTRADecision>,
  outputs: ASTRAOutput[],
  prose: ProseParser,
): any[] {
  const findingEntries = Object.entries(findings);
  // Empty findings → no output. The page no longer wraps findings in
  // a section heading, so an empty placeholder would be a stray
  // sentence floating in the middle of the document.
  if (findingEntries.length === 0) return [];

  const nodes: any[] = [];
  let index = 1;

  for (const [findingId, finding] of findingEntries) {
    if (index > 1) {
      nodes.push(thematicBreak());
    }
    nodes.push(...renderFinding(finding, index, findingId, results, decisions, prose));
    index++;
  }

  return nodes;
}

function renderFinding(
  finding: ASTRAInsight,
  index: number,
  findingId: string,
  results: Map<string, string>,
  decisions: Record<string, ASTRADecision>,
  prose: ProseParser,
): any[] {
  const nodes: any[] = [];
  const identifier = `finding-${findingId}`;

  // Finding heading: claim parsed as inline Markdown so emphasis and
  // code spans render, and any anchor links resolve. Numeric prefix
  // stays as plain text.
  nodes.push(heading(3, [text(`${index}. `), ...prose.inline(finding.claim)], identifier));

  // Notes parse as full Markdown — block-level structure (multiple
  // paragraphs, lists, code blocks) is intentionally allowed.
  if (finding.notes) {
    nodes.push(...prose.blocks(finding.notes));
  }

  // Scope
  if (finding.scope) {
    nodes.push(paragraph([emphasis([text(`Scope: ${finding.scope}`)])]));
  }

  // Evidence blocks (figures, tables, artifact references)
  for (const evidence of finding.evidence) {
    nodes.push(...renderEvidenceBlock(evidence, results, prose));
  }

  // Methodology callout with cross-references to tag-overlapping
  // decisions. The wrapping prose ("depends on:") and admonition
  // are renderer-imposed and slated for removal in a follow-up
  // commit; the crossReferences themselves stay because they're
  // genuine structural relations the author authored via tags.
  const methodLinks = buildMethodologyLinks(finding, decisions);
  if (methodLinks.length > 0) {
    const linkParts: any[] = [text('This finding depends on: ')];
    for (let i = 0; i < methodLinks.length; i++) {
      if (i > 0 && i === methodLinks.length - 1) {
        linkParts.push(text(', and '));
      } else if (i > 0) {
        linkParts.push(text(', '));
      }
      linkParts.push(
        crossReference(methodLinks[i].identifier, [text(methodLinks[i].label)]),
      );
    }
    linkParts.push(text('.'));

    nodes.push(
      admonition('seealso', [
        admonitionTitle([text('Methodology')]),
        paragraph(linkParts),
      ]),
    );
  }

  return nodes;
}

/**
 * Decisions whose tags overlap with a finding's tags. Each yields a
 * crossReference to the decision's `decision-<id>` heading. No
 * grouping, no section labels — the caller composes whatever
 * presentation it wants. Decision label is the user-facing handle;
 * fall back to the id.
 */
function buildMethodologyLinks(
  finding: ASTRAInsight,
  decisions: Record<string, ASTRADecision>,
): Array<{ label: string; identifier: string }> {
  if (!finding.tags || finding.tags.length === 0) return [];

  const links: Array<{ label: string; identifier: string }> = [];

  for (const [id, decision] of Object.entries(decisions)) {
    if (decision.from || !decision.tags) continue;

    const hasOverlap = decision.tags.some((dt) => finding.tags!.includes(dt));
    if (!hasOverlap) continue;

    links.push({ label: decision.label ?? id, identifier: `decision-${id}` });
  }

  return links;
}
