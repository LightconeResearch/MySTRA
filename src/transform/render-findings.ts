/**
 * Renders findings as flat per-finding blocks: an h3 heading
 * carrying `finding-<id>`, the author's notes prose, scope, and
 * evidence blocks. Tags ride along on the heading's mdast `data`
 * slot for consumers that want to compose grouping or relations.
 *
 * No implicit relational inference. Earlier versions emitted
 * crossReferences to "tag-overlapping" decisions — same shape as
 * the deleted TAG_TO_SECTION ontology, just inverted. Relations
 * between elements are narrated in the report, where the author
 * references both sides explicitly; the renderer doesn't
 * synthesise them.
 */

import type { Insight, Output } from '@astra-spec/sdk';
import {
  heading,
  paragraph,
  text,
  emphasis,
} from './ast-helpers.js';
import type { ArtifactResolver } from '../loader.js';
import type { ProseParser } from './prose.js';
import { renderEvidenceBlock } from './render-evidence.js';

export function renderFinding(
  finding: Insight,
  index: number,
  findingId: string,
  results: ArtifactResolver,
  outputs: Map<string, Output>,
  prose: ProseParser,
  opts?: {
    /** Parts to render (of notes / scope / evidence); all when absent. The
     *  claim heading — the finding's identifier carrier — is always kept. */
    parts?: Set<string>;
    /** Absolute artifact path → servable URL, for figure evidence. */
    resultUrl?: (absPath: string) => string;
    /** The page's vfile, for broken-reference diagnostics. */
    vfile?: any;
  },
): any[] {
  const parts = opts?.parts;
  const has = (part: string) => !parts || parts.has(part);
  const nodes: any[] = [];
  const identifier = `finding-${findingId}`;

  // Finding heading: claim parsed as inline Markdown so emphasis and
  // code spans render. Numeric prefix stays as plain text.
  // Tags survive on the mdast `data` slot —
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
  if (has('notes') && finding.notes) {
    nodes.push(...prose.blocks(finding.notes));
  }

  // Scope
  if (has('scope') && finding.scope) {
    nodes.push(paragraph([emphasis([text(`Scope: ${finding.scope}`)])]));
  }

  // Evidence blocks (figures, tables, artifact references)
  if (has('evidence')) {
    for (const evidence of finding.evidence ?? []) {
      nodes.push(
        ...renderEvidenceBlock(evidence, results, outputs, prose, {
          resultUrl: opts?.resultUrl,
          vfile: opts?.vfile,
        }),
      );
    }
  }

  return nodes;
}
