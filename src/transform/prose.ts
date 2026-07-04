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
import { liftChildren } from 'myst-common';

// ── Parsing ───────────────────────────────────────────────────────

/**
 * Parse Markdown and lift the `mystDirective` wrappers myst-parser keeps
 * around expanded directive content — the canonical output (an `admonition`,
 * a `container`, …) sits inside as children, which downstream renderers
 * consume. The tree is freshly parsed, so the in-place lift is safe.
 */
function parseAndLift(md: string): any {
  const tree = mystParse(md);
  liftChildren(tree, 'mystDirective');
  return tree;
}

/**
 * Parse a Markdown string into mdast block nodes (paragraphs, headings, lists,
 * …), with directive wrappers lifted and positions stripped.
 */
export function parseProseBlocks(md: string | undefined): any[] {
  if (!md) return [];
  return (parseAndLift(md).children ?? []).map(stripPositions);
}

/**
 * Parse a Markdown string and return only the inline phrasing content. Used for
 * fields that must be inline (table cells, captions, headings, single-line
 * claims). A single paragraph is unwrapped; otherwise phrasing is flattened
 * across blocks so author input that overshoots an inline context still survives.
 */
export function parseProseInline(md: string | undefined): any[] {
  if (!md) return [];
  const blocks = parseAndLift(md).children ?? [];
  if (blocks.length === 0) return [];
  if (blocks.length === 1 && blocks[0].type === 'paragraph') {
    return (blocks[0].children ?? []).map(stripPositions);
  }
  // Multi-block input: flatten via extractInline's recursive space-joining.
  return extractInline({ type: 'root', children: blocks });
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

/** The parser pair threaded through the render helpers. */
export interface ProseParser {
  blocks(md: string | undefined): any[];
  inline(md: string | undefined): any[];
}

/** The one (stateless) prose parser — shared by every scope and renderer. */
export const proseParser: ProseParser = {
  blocks: parseProseBlocks,
  inline: parseProseInline,
};

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
