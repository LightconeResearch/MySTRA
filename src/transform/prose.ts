/**
 * The prose engine: parse the Markdown embedded in ASTRA *components*, and
 * resolve ASTRA cross-reference links within it.
 *
 * Every Markdown field on a component — `Insight.claim`, `Decision.rationale`,
 * `Option/Input/Output.description`, captions, finding notes — flows through
 * `myst-parser`, so MySTRA stays MyST-native and emits the same `mdast` themes
 * consume.
 *
 * Cross-reference links `[text](#astra:<path>)` use the unified path grammar
 * (see `../path.ts`); they arrive from myst-parser as ordinary `link` nodes, and
 * `resolveNarrativeAnchors` rewrites in-page ones into MyST `crossReference`
 * nodes and cross-page ones into plain links pointing at the destination page.
 */

import { mystParse } from 'myst-parser';
import { fileWarn } from 'myst-common';
import { parse as parsePath } from 'node:path';
import type { Analysis, Insight } from '@astra-spec/sdk';
import type { ArtifactResolver } from '../loader.js';
import { link } from './ast-helpers.js';
import { parseAstraPath, pathIdentifier } from '../path.js';

// ── Parsing ───────────────────────────────────────────────────────

/**
 * Parse a Markdown string into mdast block nodes (paragraphs, headings, lists,
 * …). When `context` is provided, `#astra:<path>` cross-reference links are
 * resolved as a post-pass; without context they survive as plain `link` nodes.
 */
export function parseProseBlocks(md: string | undefined, context?: ProseContext): any[] {
  if (!md) return [];
  const tree = mystParse(md);
  const blocks = (tree.children ?? []).map(stripPositions);
  return context ? resolveWithContext(blocks, context) : blocks;
}

/**
 * Parse a Markdown string and return only the inline phrasing content. Used for
 * fields that must be inline (table cells, captions, headings, single-line
 * claims). A single paragraph is unwrapped; otherwise phrasing is flattened
 * across blocks so author input that overshoots an inline context still survives.
 */
export function parseProseInline(md: string | undefined, context?: ProseContext): any[] {
  if (!md) return [];
  const tree = mystParse(md);
  const blocks = tree.children ?? [];
  if (blocks.length === 0) return [];
  let inline: any[];
  if (blocks.length === 1 && blocks[0].type === 'paragraph') {
    inline = (blocks[0].children ?? []).map(stripPositions);
  } else {
    inline = [];
    for (let i = 0; i < blocks.length; i++) {
      const phrasing = extractInline(blocks[i]);
      if (phrasing.length === 0) continue;
      if (inline.length > 0) inline.push({ type: 'text', value: ' ' });
      inline.push(...phrasing);
    }
  }
  return context ? resolveWithContext(inline, context) : inline;
}

function resolveWithContext(nodes: any[], context: ProseContext): any[] {
  return resolveNarrativeAnchors(
    nodes,
    context.analysis,
    context.slug,
    context.priorInsightScopes,
    context.results,
    context.analysisScopes,
    context.vfile,
  );
}

/**
 * Report through MyST's per-file diagnostics channel when a vfile is in scope
 * (`myst build` attributes the message to the page and strict mode can gate on
 * it); fall back to the console for vfile-less programmatic callers.
 */
function warn(vfile: any | undefined, message: string): void {
  if (vfile) fileWarn(vfile, message, { source: 'mystra' });
  else console.warn(`[mystra] ${message}`);
}

/**
 * Pull inline phrasing content out of a single block-level mdast node, dropping
 * the block wrapper. Paragraphs and headings expose inline children directly;
 * lists / blockquotes recurse; code blocks surface their text as a text node.
 */
function extractInline(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return Array.isArray(node.children) ? node.children.map(stripPositions) : [];
    case 'code':
      return typeof node.value === 'string' ? [{ type: 'text', value: node.value }] : [];
    case 'thematicBreak':
      return [];
    default:
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
 * Resolution context carried through every render-* helper that touches prose.
 * Created once per scope (by the plugin's `resolveScope`) and threaded into the
 * renderers via the `ProseParser` factory.
 */
export interface ProseContext {
  analysis: Analysis;
  slug: string;
  priorInsightScopes?: PriorInsightScope[];
  analysisScopes?: AnalysisScope[];
  results?: ArtifactResolver;
  /** The page being processed, when known — routes warnings to MyST's diagnostics. */
  vfile?: any;
}

export interface PriorInsightScope {
  slug: string;
  priorInsights: Record<string, Insight>;
}

export interface AnalysisScope {
  slug: string;
  analysis: Analysis;
}

/** Pre-bound parser pair — convenient when one render helper makes many calls. */
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
 * Recursively strip the `position` field markdown-it injects. The book-theme
 * ignores it, but it bloats the JSON payload and makes snapshots noisy.
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
 * Resolve a `#astra:<path>` cross-reference URL against the page scope.
 *
 * Returns either an `identifier` (an in-page `crossReference`) or a `url` (a
 * cross-page link, or an unresolved fallback). Paths use the unified grammar
 * (see ../path.ts): they resolve relative to the page scope, with a leading `/`
 * for the root analysis and `../` to climb scopes.
 *
 * Identifier scheme — every rendered element carries `<kind>-<id>`:
 *   decisions → decision-<id>   findings → finding-<id>   inputs → input-<id>
 *   outputs   → output-<id>     prior_insights → prior_insight-<id>
 *   options/evidence children collapse to their parent element's identifier.
 */
export function resolveAstraAnchor(
  url: string,
  analysis: Analysis,
  slug: string,
  priorInsightScopes: PriorInsightScope[] = [],
): { identifier: string } | { url: string } {
  const raw = url.replace(/^#astra:/, '');
  const p = parseAstraPath(raw);
  const pageScope = slug === 'index' ? [] : slug.split('/');
  const targetScope = p.absolute
    ? [...p.scope]
    : [...pageScope.slice(0, Math.max(0, pageScope.length - p.up)), ...p.scope];
  const samePage = arraysEqual(targetScope, pageScope);
  const fallback = { url: `#astra:${raw}` };

  // Prior insights inherit down the tree; the carrier lives on whichever
  // ancestor page declares it, so search the ancestor scope stack.
  if (p.collection === 'prior_insights' && p.id) {
    if (samePage && p.id in (analysis.prior_insights ?? {})) {
      return { identifier: `prior_insight-${p.id}` };
    }
    const anc = nearestPriorInsightScope(priorInsightScopes, p.id);
    if (anc) return { url: `${pageUrl(anc.slug)}#prior_insight-${p.id}` };
    return samePage ? fallback : { url: `${pageUrlFor(targetScope)}#prior_insight-${p.id}` };
  }

  // A bare sub-analysis → a link to its page.
  if (!p.collection) {
    return targetScope.length ? { url: pageUrlFor(targetScope) } : fallback;
  }
  // A whole collection (a registry) is not a single anchor target.
  if (!p.id) return fallback;

  const ident = pathIdentifier(p)!;
  if (samePage) {
    return existsInScope(analysis, p.collection, p.id) ? { identifier: ident } : fallback;
  }
  return { url: `${pageUrlFor(targetScope)}#${ident}` };
}

function existsInScope(analysis: Analysis, collection: string, id: string): boolean {
  switch (collection) {
    case 'decisions':
      return !!analysis.decisions?.[id];
    case 'findings':
      return !!analysis.findings?.[id];
    case 'inputs':
      return (analysis.inputs ?? []).some((i) => i.id === id);
    case 'outputs':
      return (analysis.outputs ?? []).some((o) => o.id === id);
    case 'analyses':
      return !!analysis.analyses?.[id];
    default:
      return false;
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function pageUrl(slug: string): string {
  return slug === 'index' ? '/' : `/${slug}`;
}

function pageUrlFor(scope: string[]): string {
  return scope.length === 0 ? '/' : `/${scope.join('/')}`;
}

function nearestPriorInsightScope(
  scopes: PriorInsightScope[],
  insightId: string,
): PriorInsightScope | undefined {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (insightId in scopes[i].priorInsights) return scopes[i];
  }
  return undefined;
}

/**
 * Walk a node tree and rewrite `link` nodes whose URL is a `#astra:` reference
 * into the resolver's verdict — either a `crossReference` (identifier resolved)
 * or a plain `link` (cross-page / unresolved). `![](#astra:outputs.<id>)` image
 * embeds (in-scope figures) are rewritten to their `/static/` artifact URL.
 */
export function resolveNarrativeAnchors(
  nodes: any[],
  analysis: Analysis,
  slug: string,
  priorInsightScopes: PriorInsightScope[] = [],
  results?: ArtifactResolver,
  _analysisScopes: AnalysisScope[] = [],
  vfile?: any,
): any[] {
  return nodes.flatMap((node) =>
    flatten(rewrite(node, analysis, slug, priorInsightScopes, results, vfile)),
  );
}

function flatten(r: any | any[] | null | undefined): any[] {
  if (r === null || r === undefined) return [];
  return Array.isArray(r) ? r : [r];
}

function rewrite(
  node: any,
  analysis: Analysis,
  slug: string,
  priorInsightScopes: PriorInsightScope[],
  results: ArtifactResolver | undefined,
  vfile: any | undefined,
): any | any[] | null {
  if (!node || typeof node !== 'object') return node;

  if (node.type === 'link' && typeof node.url === 'string' && node.url.startsWith('#astra:')) {
    const verdict = resolveAstraAnchor(node.url, analysis, slug, priorInsightScopes);
    // Emit a `link` to the local identifier rather than a `crossReference` node:
    // MyST's resolver fills the number/label for links during its own pipeline
    // but leaves plugin-injected crossReferences unresolved (`\ref{undefined}`).
    return 'identifier' in verdict
      ? link(`#${verdict.identifier}`, node.children ?? [])
      : link(verdict.url, node.children ?? []);
  }

  if (node.type === 'image' && typeof node.url === 'string' && node.url.startsWith('#astra:')) {
    return rewriteOutputImage(node, analysis, results, vfile);
  }

  // Unwrap the `mystDirective` wrapper myst-parser keeps around expanded
  // directive content: the canonical directive output (a `container`, an
  // `admonition`, …) sits inside as a single child, which downstream renderers
  // consume. Children are still rewritten so anchors inside resolve.
  if (node.type === 'mystDirective' && Array.isArray(node.children)) {
    return node.children.flatMap((c: any) =>
      flatten(rewrite(c, analysis, slug, priorInsightScopes, results, vfile)),
    );
  }

  if (Array.isArray(node.children)) {
    return {
      ...node,
      children: node.children.flatMap((c: any) =>
        flatten(rewrite(c, analysis, slug, priorInsightScopes, results, vfile)),
      ),
    };
  }
  return node;
}

/**
 * Rewrite an `![](#astra:outputs.<id>)` figure embed to its artifact URL. Only
 * in-scope figure outputs are embeddable this way (the page's artifact resolver
 * is scope-local); a non-figure, cross-scope, unknown, or unproduced target is
 * dropped with a warning.
 */
function rewriteOutputImage(
  node: any,
  analysis: Analysis,
  results: ArtifactResolver | undefined,
  vfile: any | undefined,
): any | null {
  const p = parseAstraPath(String(node.url).replace(/^#astra:/, ''));
  if (p.collection !== 'outputs' || !p.id) {
    warn(vfile, `image embed "${node.url}" does not point at an output — dropped.`);
    return null;
  }
  if (p.scope.length > 0 || p.absolute || !results) {
    warn(vfile, `image embed "${node.url}" must be an in-scope output — dropped.`);
    return null;
  }
  const output = (analysis.outputs ?? []).find((o) => o.id === p.id);
  if (!output) {
    warn(vfile, `image embed references unknown output "${p.id}" — dropped.`);
    return null;
  }
  if (output.type !== 'figure') {
    warn(
      vfile,
      `image embed references non-figure output "${p.id}" (type: ${output.type}) — dropped.`,
    );
    return null;
  }
  const resultPath = results(p.id);
  if (!resultPath) {
    warn(vfile, `image embed references unproduced output "${p.id}" — dropped.`);
    return null;
  }
  const ext = parsePath(resultPath).ext.slice(1).toLowerCase();
  return { ...node, url: `/static/${p.id}.${ext}` };
}
