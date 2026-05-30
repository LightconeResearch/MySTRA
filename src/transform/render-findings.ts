/**
 * Renders findings as flat per-finding blocks: an h3 heading
 * carrying `finding-<id>`, the author's notes prose, scope, and
 * evidence blocks. Tags ride along on the heading's mdast `data`
 * slot for consumers that want to compose grouping or relations.
 *
 * No implicit relational inference. Earlier versions emitted
 * crossReferences to "tag-overlapping" decisions — same shape as
 * the deleted TAG_TO_SECTION ontology, just inverted. The author
 * narrates relations explicitly through the v0.0.6 anchor grammar
 * (a methods narrative, a finding-claim link, an option
 * description); the renderer doesn't synthesise them.
 */

import type {
  Insight as ASTRAInsight,
  Output as ASTRAOutput,
} from '@astra-spec/sdk';
import {
  heading,
  paragraph,
  text,
  emphasis,
  thematicBreak,
} from './ast-helpers.js';
import type { ProseParser } from './narrative-parser.js';
import { renderEvidenceBlock } from './render-evidence.js';

export function renderFindings(
  findings: Record<string, ASTRAInsight>,
  results: Map<string, string>,
  outputs: Map<string, ASTRAOutput>,
  prose: ProseParser,
  doiCacheDir: string | null,
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
    nodes.push(...renderFinding(finding, index, findingId, results, outputs, prose, doiCacheDir));
    index++;
  }

  return nodes;
}

function renderFinding(
  finding: ASTRAInsight,
  index: number,
  findingId: string,
  results: Map<string, string>,
  outputs: Map<string, ASTRAOutput>,
  prose: ProseParser,
  doiCacheDir: string | null,
): any[] {
  const nodes: any[] = [];
  const identifier = `finding-${findingId}`;

  // Finding heading: claim parsed as inline Markdown so emphasis and
  // code spans render, and any anchor links resolve. Numeric prefix
  // stays as plain text. Tags survive on the mdast `data` slot —
  // consumers that want grouping (paper view, dashboard) read them
  // there; MySTRA imposes no grouping of its own.
  const head: any = heading(
    3,
    [text(`${index}. `), ...prose.inline(finding.claim)],
    identifier,
  );
  if (finding.tags && finding.tags.length > 0) {
    head.data = { ...(head.data ?? {}), tags: finding.tags };
  }
  nodes.push(head);

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
    nodes.push(...renderEvidenceBlock(evidence, results, outputs, prose, doiCacheDir));
  }

  return nodes;
}
