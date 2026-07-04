/**
 * The prose engine: parse the Markdown embedded in ASTRA *components*.
 *
 * Every Markdown field on a component — `Insight.claim`, `Decision.rationale`,
 * `Option/Input/Output.description`, captions, finding notes — flows through
 * `myst-parser`, so MySTRA stays MyST-native and emits the same `mdast` themes
 * consume.
 *
 * Prose is plain MyST Markdown. ASTRA does not define an in-prose element
 * reference syntax (RFC-0002 left prose fields free-form); referencing is done
 * from the report side via the `{astra}` role/directive surfaces.
 */

import { mystParse } from 'myst-parser';
import type { Analysis, Insight } from '@astra-spec/sdk';

// ── Parsing ───────────────────────────────────────────────────────

/**
 * Parse a Markdown string into mdast block nodes (paragraphs, headings, lists,
 * …), with `mystDirective` wrappers unwrapped and positions stripped.
 */
export function parseProseBlocks(md: string | undefined): any[] {
  if (!md) return [];
  const tree = mystParse(md);
  return (tree.children ?? []).map(stripPositions).flatMap(unwrapDirectives);
}

/**
 * Parse a Markdown string and return only the inline phrasing content. Used for
 * fields that must be inline (table cells, captions, headings, single-line
 * claims). A single paragraph is unwrapped; otherwise phrasing is flattened
 * across blocks so author input that overshoots an inline context still survives.
 */
export function parseProseInline(md: string | undefined): any[] {
  if (!md) return [];
  const tree = mystParse(md);
  const blocks = tree.children ?? [];
  if (blocks.length === 0) return [];
  if (blocks.length === 1 && blocks[0].type === 'paragraph') {
    return (blocks[0].children ?? []).map(stripPositions);
  }
  const inline: any[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const phrasing = extractInline(blocks[i]);
    if (phrasing.length === 0) continue;
    if (inline.length > 0) inline.push({ type: 'text', value: ' ' });
    inline.push(...phrasing);
  }
  return inline;
}

/**
 * Unwrap the `mystDirective` wrapper myst-parser keeps around expanded
 * directive content: the canonical directive output (a `container`, an
 * `admonition`, …) sits inside as children, which downstream renderers
 * consume. Recurses so directives nested in other blocks unwrap too.
 */
function unwrapDirectives(node: any): any[] {
  if (!node || typeof node !== 'object') return [node];
  if (node.type === 'mystDirective' && Array.isArray(node.children)) {
    return node.children.flatMap(unwrapDirectives);
  }
  if (Array.isArray(node.children)) {
    return [{ ...node, children: node.children.flatMap(unwrapDirectives) }];
  }
  return [node];
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
 * Ancestor-scope stacks the plugin threads through scope resolution (prior
 * insights inherit down the analysis tree; cross-scope store merging needs the
 * ancestor analyses).
 */
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

export function makeProseParser(): ProseParser {
  return {
    blocks: (md) => parseProseBlocks(md),
    inline: (md) => parseProseInline(md),
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
