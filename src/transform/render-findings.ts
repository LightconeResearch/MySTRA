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
import { TAG_TO_SECTION } from './tag-sections.js';
import { toSlug } from '../utils/slug.js';

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

  // Methodology callout with cross-references to relevant method sections
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
        crossReference(methodLinks[i].sectionId, [text(methodLinks[i].sectionLabel)]),
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
 * Find method sections relevant to a finding by matching tags.
 */
function buildMethodologyLinks(
  finding: ASTRAInsight,
  decisions: Record<string, ASTRADecision>,
): Array<{ sectionLabel: string; sectionId: string }> {
  if (!finding.tags || finding.tags.length === 0) return [];

  const seenSections = new Set<string>();
  const links: Array<{ sectionLabel: string; sectionId: string }> = [];

  for (const [, decision] of Object.entries(decisions)) {
    if (decision.from || !decision.tags) continue;

    const hasOverlap = decision.tags.some((dt) => finding.tags!.includes(dt));
    if (!hasOverlap) continue;

    const firstTag = decision.tags[0];
    const sectionLabel = TAG_TO_SECTION[firstTag] ?? 'Other';
    if (seenSections.has(sectionLabel)) continue;
    seenSections.add(sectionLabel);

    links.push({ sectionLabel, sectionId: toSlug(sectionLabel) });
  }

  return links;
}
