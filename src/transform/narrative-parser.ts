/**
 * Narrative-aware Markdown parser + anchor resolver.
 *
 * Parses an `Analysis.narrative` section (a Markdown string) into MyST
 * mdast block nodes. Inline subset matches the rest of MySTRA: text,
 * **strong**, *emphasis*, `code`, [link](url). Block layer splits on
 * blank lines into paragraphs.
 *
 * Anchor links of the form `[text](#path.to.element)` use the ASTRA
 * tree-path grammar described in the Narrative class (astra-spec
 * v0.0.6, src/astra/schema/analysis.yaml). They become MyST
 * `crossReference` nodes pointing at the corresponding ASTRA element
 * within the host analysis. Anchors that cannot be resolved
 * (sub-analysis traversal, parent escape via `../`, prior_insights
 * which don't yet have page identifiers) fall back to ordinary `link`
 * nodes with the original `#path.to.element` URL — the AST stays
 * valid and the theme renders them as inert anchors.
 *
 * Why a hand-rolled parser? We don't pull `myst-parser` as a runtime
 * dep — narratives are short and the inline grammar we need is the
 * same subset already supported by `inline-parser.ts`. The block
 * layer (paragraphs) is a one-liner.
 */

import type { ASTRAAnalysis } from '../types/astra.js';
import { paragraph, crossReference, link } from './ast-helpers.js';
import { parseInlineMarkdown } from './inline-parser.js';

export function parseNarrativeMarkdown(md: string): any[] {
  return md
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((p) => paragraph(parseInlineMarkdown(p)));
}

/**
 * Tree-path anchor resolution. Returns either an `identifier` (for an
 * in-page crossReference) or a `url` (for an off-page or unresolvable
 * link). The host analysis is needed to know which IDs exist locally;
 * the slug for the analysis is needed to build sub-analysis links.
 */
export function resolveAnchorPath(
  path: string,
  analysis: ASTRAAnalysis,
  slug: string,
): { identifier: string } | { url: string } {
  // Strip a leading '#'; tolerate either form.
  const ref = path.replace(/^#/, '');

  // `../` prefix escapes to parent scope — we don't have the parent
  // chain at render time, so fall back to a link with the raw href.
  if (ref.startsWith('../')) return { url: `#${ref}` };

  const segments = ref.split('.');
  const [head, ...rest] = segments;

  // Sub-analysis traversal — `#analyses.<id>[...rest]` or the bare
  // analysis-as-leaf shorthand `#<sub_id>.outputs.<o>` where <sub_id>
  // is an ID in `analysis.analyses`.
  if (head === 'analyses' && rest.length >= 1) {
    return subAnalysisUrl(rest[0], rest.slice(1), slug);
  }
  if (analysis.analyses && head in analysis.analyses) {
    return subAnalysisUrl(head, rest, slug);
  }

  // In-scope categories.
  switch (head) {
    case 'findings':
      return rest.length === 1 && rest[0] in (analysis.findings ?? {})
        ? { identifier: `finding-${rest[0]}` }
        : { url: `#${ref}` };
    case 'decisions':
      // decisions.<id> and decisions.<id>.options.<opt> both resolve
      // to the decision heading; option-level identifiers don't yet
      // exist in MySTRA's xref scheme.
      return rest.length >= 1 && rest[0] in (analysis.decisions ?? {})
        ? { identifier: rest[0] }
        : { url: `#${ref}` };
    // No identifiers for these yet — keep as inert links so the
    // anchor grammar round-trips visibly without breaking the AST.
    case 'prior_insights':
    case 'inputs':
    case 'outputs':
      return { url: `#${ref}` };
    default:
      return { url: `#${ref}` };
  }
}

function subAnalysisUrl(
  subId: string,
  rest: string[],
  hostSlug: string,
): { url: string } {
  const base = hostSlug === 'index' ? `/${subId}` : `/${hostSlug}/${subId}`;
  return rest.length === 0 ? { url: base } : { url: `${base}#${rest.join('.')}` };
}

/**
 * Walk a node tree and rewrite `link` nodes whose URL is an anchor
 * (`#...`) into the resolver's verdict — either a `crossReference`
 * (identifier resolved) or a plain `link` (left as-is, anchor or
 * sub-analysis URL).
 */
export function resolveNarrativeAnchors(
  nodes: any[],
  analysis: ASTRAAnalysis,
  slug: string,
): any[] {
  return nodes.map((node) => rewrite(node, analysis, slug));
}

function rewrite(node: any, analysis: ASTRAAnalysis, slug: string): any {
  if (!node || typeof node !== 'object') return node;

  if (node.type === 'link' && typeof node.url === 'string' && node.url.startsWith('#')) {
    const verdict = resolveAnchorPath(node.url, analysis, slug);
    if ('identifier' in verdict) {
      return crossReference(verdict.identifier, node.children ?? []);
    }
    return link(verdict.url, node.children ?? []);
  }

  if (Array.isArray(node.children)) {
    return { ...node, children: node.children.map((c: any) => rewrite(c, analysis, slug)) };
  }
  return node;
}
