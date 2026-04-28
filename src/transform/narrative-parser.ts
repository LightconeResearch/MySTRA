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
 *
 * When `context` is provided, the v0.0.6 narrative anchor grammar
 * (`[t](#path.to.element)`) is resolved as a post-pass so anchors
 * become `crossReference` nodes pointing at the corresponding
 * structural element. Without context, anchor links survive as
 * plain `link` nodes.
 */
export function parseProseBlocks(
  md: string | undefined,
  context?: ProseContext,
): any[] {
  if (!md) return [];
  const tree = mystParse(md);
  const blocks = (tree.children ?? []).map(stripPositions);
  return context
    ? resolveNarrativeAnchors(blocks, context.analysis, context.slug)
    : blocks;
}

/**
 * Parse a Markdown string and return only the inline phrasing
 * content. Used for fields that must be inline (table cells,
 * captions, headings, blockquote attribution, single-line claims).
 *
 * If the input parses to a single paragraph we unwrap its children;
 * otherwise we flatten across blocks. Author input that
 * accidentally contains block-level structure (a stray heading, a
 * list, a code block) shouldn't silently vanish — extract the
 * inline phrasing content from each block, separated by spaces, so
 * captions and claims survive even if the author overshot what an
 * inline context allows.
 *
 * `context` enables anchor resolution; see `parseProseBlocks`.
 */
export function parseProseInline(
  md: string | undefined,
  context?: ProseContext,
): any[] {
  if (!md) return [];
  const tree = mystParse(md);
  const blocks = tree.children ?? [];
  if (blocks.length === 0) return [];
  let inline: any[];
  if (blocks.length === 1 && blocks[0].type === 'paragraph') {
    inline = (blocks[0].children ?? []).map(stripPositions);
  } else {
    // Multi-block input where only inline is allowed: extract
    // phrasing from each block and concatenate. Paragraphs and
    // headings expose `children` directly; lists / code blocks
    // need a recursive walk to collect text.
    inline = [];
    for (let i = 0; i < blocks.length; i++) {
      const phrasing = extractInline(blocks[i]);
      if (phrasing.length === 0) continue;
      if (inline.length > 0) inline.push({ type: 'text', value: ' ' });
      inline.push(...phrasing);
    }
  }
  return context
    ? resolveNarrativeAnchors(inline, context.analysis, context.slug)
    : inline;
}

/**
 * Pull inline phrasing content out of a single block-level mdast
 * node, dropping the block wrapper. Paragraphs and headings expose
 * inline children directly; lists / blockquotes recurse; code
 * blocks surface their text as a single text node.
 */
function extractInline(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return Array.isArray(node.children)
        ? node.children.map(stripPositions)
        : [];
    case 'code':
      // Fenced/indented code in an inline context: surface as text
      // so the content survives even if styling is lost.
      return typeof node.value === 'string' ? [{ type: 'text', value: node.value }] : [];
    case 'thematicBreak':
      return [];
    default:
      // list, blockquote, table, container, … — flatten children.
      if (!Array.isArray(node.children)) return [];
      const out: any[] = [];
      for (const child of node.children) {
        const piece = extractInline(child);
        if (piece.length === 0) continue;
        if (out.length > 0) out.push({ type: 'text', value: ' ' });
        out.push(...piece);
      }
      return out;
  }
}

/**
 * Resolution context carried through every render-* helper that
 * touches prose. Created once per page in `astraToMystAST` and
 * threaded into the renderers via the `ProseParser` factory.
 */
export interface ProseContext {
  analysis: ASTRAAnalysis;
  slug: string;
}

/**
 * Pre-bound parser pair — convenient when one render helper makes
 * many parse calls. Equivalent to passing `context` on each call.
 */
export interface ProseParser {
  blocks(md: string | undefined): any[];
  inline(md: string | undefined): any[];
}

export function makeProseParser(context: ProseContext): ProseParser {
  return {
    blocks: (md) => parseProseBlocks(md, context),
    inline: (md) => parseProseInline(md, context),
  };
}

/**
 * Extract the first paragraph of a Markdown string as a plain-text
 * single line — suitable for OpenGraph / SEO descriptions and
 * sub-analysis card previews. Walks the parsed mdast and collects
 * `text`/`inlineCode` leaves under the first `paragraph` block,
 * preserving order and inserting natural spaces. Anchor links and
 * formatting (emphasis, strong, code) collapse to their visible
 * text. Returns `undefined` if the input is empty or contains no
 * paragraph block.
 */
export function firstParagraphText(md: string | undefined): string | undefined {
  if (!md) return undefined;
  const tree = mystParse(md);
  const blocks = tree.children ?? [];
  const para = blocks.find((b: any) => b?.type === 'paragraph');
  if (!para) return undefined;
  const collected = collectVisibleText(para).trim().replace(/\s+/g, ' ');
  return collected || undefined;
}

function collectVisibleText(node: any): string {
  if (!node || typeof node !== 'object') return '';
  // Leaf-level visible text. `text` and `inlineCode` carry literal
  // strings; `link` children carry the link's display text (the URL
  // doesn't belong in an SEO description).
  if (node.type === 'text' && typeof node.value === 'string') return node.value;
  if (node.type === 'inlineCode' && typeof node.value === 'string') return node.value;
  if (Array.isArray(node.children)) {
    return node.children.map(collectVisibleText).join('');
  }
  return '';
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
 *
 * Identifier scheme (every structural element + narrative chunk gets
 * a stable id anchor — `<kind>-<id>`):
 *
 *   decisions       → `decision-<id>`
 *   findings        → `finding-<id>`
 *   prior_insights  → `prior_insight-<id>`
 *   inputs          → `input-<id>`
 *   outputs         → `output-<id>`
 *   narrative       → `narrative-<section>`
 *   sub-analyses    → cross-page URL (separate pages, not in-page anchors)
 *   parent (`../`)  → inert link (cross-scope resolution is its own thing)
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
        ? { identifier: `decision-${rest[0]}` }
        : { url: `#${ref}` };
    case 'prior_insights':
      return rest.length === 1 && rest[0] in (analysis.prior_insights ?? {})
        ? { identifier: `prior_insight-${rest[0]}` }
        : { url: `#${ref}` };
    case 'inputs':
      return rest.length === 1 && (analysis.inputs ?? []).some((i) => i.id === rest[0])
        ? { identifier: `input-${rest[0]}` }
        : { url: `#${ref}` };
    case 'outputs':
      return rest.length === 1 && (analysis.outputs ?? []).some((o) => o.id === rest[0])
        ? { identifier: `output-${rest[0]}` }
        : { url: `#${ref}` };
    // Narrative chunks: `#narrative.<section>` resolves to the
    // chunk identifier published by render-narrative.
    case 'narrative':
      if (
        rest.length === 1 &&
        ['summary', 'findings', 'methods', 'inputs', 'outputs'].includes(rest[0]) &&
        analysis.narrative &&
        (analysis.narrative as any)[rest[0]]
      ) {
        return { identifier: `narrative-${rest[0]}` };
      }
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
  if (rest.length === 0) return { url: base };
  // Translate ASTRA tree-path grammar (`outputs.features`,
  // `decisions.scaling`) to the local mdast id convention
  // (`output-features`, `decision-scaling`) before stitching the
  // URL fragment, so cross-page anchors resolve to real ids on
  // the destination page.
  const fragment = astraPathToFragment(rest);
  return fragment ? { url: `${base}#${fragment}` } : { url: base };
}

/**
 * `[category, id]` → `<kind>-<id>` (matching the local in-page
 * identifier convention). Multi-segment paths beyond `[category, id]`
 * (e.g. `decisions.<id>.options.<opt>`) collapse to the parent
 * decision identifier — option-level anchors don't yet exist in
 * MySTRA's xref scheme, identical to the in-page resolver branch.
 *
 * `narrative.<section>` and `analyses.<id>...` are not handled here
 * because the caller has already stripped the head category; this
 * helper only sees the remainder of a sub-analysis traversal.
 */
const CATEGORY_TO_KIND: Record<string, string> = {
  findings: 'finding',
  decisions: 'decision',
  prior_insights: 'prior_insight',
  inputs: 'input',
  outputs: 'output',
  analyses: 'analysis',
};

function astraPathToFragment(segments: string[]): string {
  if (segments.length === 0) return '';
  const [head, ...rest] = segments;

  // narrative.<section> stays as-is — the carrier id is
  // `narrative-<section>` on the destination page.
  if (head === 'narrative' && rest.length === 1) {
    return `narrative-${rest[0]}`;
  }

  const kind = CATEGORY_TO_KIND[head];
  if (kind && rest.length >= 1) {
    // `decisions.<id>.options.<opt>` collapses to the parent
    // decision; same fallback as the in-scope resolver.
    return `${kind}-${rest[0]}`;
  }

  // Unrecognised path — fall back to dot-joined raw segments so
  // the URL still points at *something*; the destination renderer
  // can decide whether to treat it as a real id.
  return segments.join('.');
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
