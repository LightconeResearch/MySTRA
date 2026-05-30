/**
 * Renders Analysis.narrative as named, addressable chunks.
 *
 * Each narrative section (summary, findings, methods, inputs,
 * outputs) becomes its own block-level entry with a stable id
 * anchor (`narrative-<section>`). The anchor attaches to the first
 * child of the section's parsed mdast — no wrapping container, no
 * programmatic section heading. Downstream renderers can compose
 * sections however they like (header, sidebar, bottom, …)
 * independent of mdast position; the id anchor lets cross-
 * references find each chunk regardless of position.
 *
 * mdast order is the spec-declared order (summary → findings →
 * methods → inputs → outputs) as a deterministic default;
 * renderers are free to reorder.
 *
 * Section content is Markdown with anchor links of the form
 * `[text](#path.to.element)` per the v0.0.6 narrative grammar; both
 * Markdown parsing (via myst-parser) and anchor → crossReference
 * resolution live in `narrative-parser.ts`.
 */

import type {
  Analysis as ASTRAAnalysis,
  Narrative as ASTRANarrative,
} from '@astra-spec/sdk';
import { parseProseBlocks } from './narrative-parser.js';
import type { ProseContext } from './narrative-parser.js';
import { paragraph } from './ast-helpers.js';

const SECTION_ORDER: (keyof ASTRANarrative)[] = [
  'summary',
  'findings',
  'methods',
  'inputs',
  'outputs',
];

export interface NarrativeChunk {
  kind: 'narrative';
  section: keyof ASTRANarrative;
  identifier: string;
  /** Block-level mdast for this section's content. The first node
   *  carries the chunk's `identifier` so cross-references land. */
  mdast: any[];
}

/**
 * Decompose an analysis's narrative into per-section addressable
 * chunks. Sections without content are omitted; the resulting array
 * preserves the spec-declared section order.
 */
export function renderNarrativeChunks(
  analysis: ASTRAAnalysis,
  slug: string,
  context: ProseContext = { analysis, slug },
): NarrativeChunk[] {
  const narrative = analysis.narrative;
  if (!narrative) return [];
  const chunks: NarrativeChunk[] = [];
  for (const section of SECTION_ORDER) {
    const md = narrative[section];
    if (!md) continue;
    const identifier = `narrative-${section}`;
    const blocks = parseProseBlocks(md, context);
    // Attach the chunk identifier to its first node so xrefs to
    // `#narrative.<section>` resolve. If the section parsed empty
    // (whitespace-only Markdown), synthesize an empty paragraph
    // as the carrier.
    const carrier = blocks.length > 0 ? blocks[0] : paragraph([]);
    carrier.identifier = identifier;
    if (!carrier.label) carrier.label = identifier;
    const mdast = blocks.length > 0 ? blocks : [carrier];
    chunks.push({ kind: 'narrative', section, identifier, mdast });
  }
  return chunks;
}

/**
 * Render one narrative section (raw Markdown string) into mdast,
 * resolving in-scope anchor links to crossReferences. Used by
 * sub-analysis cards which only ever surface a single section.
 */
export function renderNarrativeSection(
  md: string | undefined,
  analysis: ASTRAAnalysis,
  slug: string,
  context: ProseContext = { analysis, slug },
): any[] {
  return parseProseBlocks(md, context);
}
