/**
 * Renders each finding as one `div` carrier bearing `finding-<id>`,
 * containing the neutral fallback: an h3 claim heading, the author's
 * description prose, scope, and evidence blocks. Nesting the fallback
 * inside the carrier means a rich theme that overrides the carrier
 * replaces the fallback with it — the same pattern the output /
 * prior-insight carriers follow. Tags ride along on the carrier's
 * mdast `data` slot for consumers that want to compose grouping or
 * relations.
 *
 * Relations between elements are narrated in the report, where the author
 * references both sides explicitly; the renderer does not infer them from
 * overlapping tags.
 */

import type { Insight, ResolvedAnalysisIndex } from '@astra-spec/sdk';
import {
  carrierDiv,
  heading,
  paragraph,
  text,
  emphasis,
} from './ast-helpers.js';
import type { ProseParser } from './prose.js';
import { renderEvidenceBlock } from './render-evidence.js';

export function renderFinding(
  finding: Insight,
  index: number,
  findingId: string,
  analysisIndex: ResolvedAnalysisIndex,
  prose: ProseParser,
  opts: {
    /** Parts to render (of description / scope / evidence). The claim heading —
     *  the finding's identifier carrier — is always kept. */
    parts: Set<string>;
    universe?: string;
    resultPath: (resultId: string) => string | undefined;
    /** Absolute artifact path → servable URL, for figure evidence. */
    resultUrl: (absPath: string) => string;
    /** The page's vfile, for broken-reference diagnostics. */
    vfile?: any;
  },
): any[] {
  const has = (part: string) => opts.parts.has(part);
  const nodes: any[] = [];

  // Finding heading: claim parsed as inline Markdown so emphasis and
  // code spans render. Numeric prefix stays as plain text. The
  // `finding-<id>` identifier lives on the carrier div (below), not
  // here — the heading is part of the neutral fallback.
  nodes.push(heading(3, [text(`${index}. `), ...prose.inline(finding.claim)]));

  // Notes parse as full Markdown — block-level structure (multiple
  // paragraphs, lists, code blocks) is intentionally allowed.
  if (has('description') && finding.description) {
    nodes.push(...prose.blocks(finding.description, 4));
  }

  // Scope
  if (has('scope') && finding.scope) {
    nodes.push(paragraph([emphasis([text(`Scope: ${finding.scope}`)])]));
  }

  // Evidence blocks (figures, tables, artifact references)
  if (has('evidence')) {
    for (const [evidenceIndex] of finding.evidence.entries()) {
      nodes.push(
        ...renderEvidenceBlock(analysisIndex, finding, evidenceIndex, prose, {
          universe: opts.universe,
          resultPath: opts.resultPath,
          resultUrl: opts.resultUrl,
          vfile: opts.vfile,
        }),
      );
    }
  }

  // One carrier div holds the whole fallback. Tags survive on its mdast
  // `data` slot — consumers that want grouping (paper view, dashboard)
  // read them there; MySTRA imposes no grouping of its own.
  const carrier: any = carrierDiv(nodes, `finding-${findingId}`);
  if (finding.tags && finding.tags.length > 0) {
    carrier.data = { ...(carrier.data ?? {}), tags: finding.tags };
  }
  return [carrier];
}
