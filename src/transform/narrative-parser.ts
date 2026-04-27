/**
 * MyST Markdown parsing for ASTRA prose fields, plus the v0.0.6
 * narrative anchor resolver.
 *
 * All Markdown content (narrative sections, Insight.claim, Decision
 * .rationale, Option/Input/Output.description, captions, finding
 * notes, …) flows through `myst-parser` so MySTRA stays MyST-native;
 * the bespoke inline parser was retired. Output is `mdast` — the
 * same node shape MyST themes consume directly.
 *
 * Anchor links of the form `[text](#path.to.element)` use the ASTRA
 * tree-path grammar described in the Narrative class (astra-spec
 * v0.0.6, src/astra/schema/analysis.yaml). They are emitted by
 * myst-parser as ordinary `link` nodes; `resolveNarrativeAnchors`
 * walks the tree post-parse and rewrites in-scope anchors into MyST
 * `crossReference` nodes pointing at the corresponding ASTRA
 * element. Anchors that escape the host scope (`../` parent
 * traversal) fall back to plain link nodes with the original URL.
 */

import { mystParse } from 'myst-parser';
import type { ASTRAAnalysis } from '../types/astra.js';
import { crossReference, link } from './ast-helpers.js';

// ── Parsing ───────────────────────────────────────────────────────

/**
 * Parse a Markdown string into mdast block nodes (paragraphs,
 * headings, lists, …). Use this for narrative sections and other
 * fields where block-level structure is meaningful.
 */
export function parseProseBlocks(md: string | undefined): any[] {
  if (!md) return [];
  const tree = mystParse(md);
  return (tree.children ?? []).map(stripPositions);
}

/**
 * Parse a Markdown string and return only the inline phrasing
 * content. Used for fields that must be inline (table cells,
 * captions, headings, blockquote attribution, single-line claims).
 *
 * If the input parses to a single paragraph we unwrap its children;
 * otherwise we flatten across paragraphs (separating with a space)
 * since the host context can't accept block-level children.
 */
export function parseProseInline(md: string | undefined): any[] {
  if (!md) return [];
  const tree = mystParse(md);
  const blocks = tree.children ?? [];
  if (blocks.length === 0) return [];
  if (blocks.length === 1 && blocks[0].type === 'paragraph') {
    return (blocks[0].children ?? []).map(stripPositions);
  }
  // Multi-block input where only inline is allowed: flatten.
  const out: any[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'paragraph' && Array.isArray(b.children)) {
      if (i > 0) out.push({ type: 'text', value: ' ' });
      for (const c of b.children) out.push(stripPositions(c));
    }
  }
  return out;
}

/**
 * Recursively strip the `position` field that markdown-it injects.
 * The book-theme ignores it, but it bloats the JSON payload and
 * makes test snapshots noisy.
 */
function stripPositions(node: any): any {
  if (!node || typeof node !== 'object') return node;
  const { position, ...rest } = node;
  if (Array.isArray(rest.children)) {
    rest.children = rest.children.map(stripPositions);
  }
  return rest;
}

// ── Anchor resolution ─────────────────────────────────────────────

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
