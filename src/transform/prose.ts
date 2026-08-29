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
import {
  basicTransformations,
  inlineMathSimplificationTransform,
  mathTransform,
} from 'myst-transforms';
import { VFile } from 'vfile';
import type { MystMathMacros } from '../myst-config.js';

// ── Parsing ───────────────────────────────────────────────────────

export interface ProseTransformOptions {
  macros?: MystMathMacros;
  firstDepth?: number;
}

/**
 * Parse and transform one isolated Markdown fragment through the same
 * pre-document stages MyST has already run on the host page.
 *
 * The synthetic block is a sentinel: `basicTransformations` otherwise wraps
 * every top-level fragment in a new block. Starting with a block makes that
 * root-nesting pass a no-op while every descendant transformation still runs;
 * the sentinel is removed before callers receive the authored nodes.
 */
function parseAndTransform(
  md: string,
  file: VFile,
  options: ProseTransformOptions,
): any {
  const parsed = mystParse(md, { vfile: file });
  const sentinel: any = {
    type: 'block',
    children: parsed.children ?? [],
  };
  const fragment: any = {
    type: 'root',
    children: [sentinel],
  };
  basicTransformations(fragment, file, {
    parser: (content: string) => mystParse(content, { vfile: file }),
    ...(options.firstDepth == null ? {} : { firstDepth: options.firstDepth }),
  });
  inlineMathSimplificationTransform(fragment, { replaceSymbol: false });
  mathTransform(fragment, file, { macros: options.macros });
  return { type: 'root', children: sentinel.children };
}

/**
 * Parse a Markdown string into mdast block nodes (paragraphs, headings, lists,
 * …), with directive wrappers lifted and positions stripped.
 */
export function parseProseBlocks(
  md: string | undefined,
  file = new VFile(),
  options: ProseTransformOptions = {},
): any[] {
  if (!md) return [];
  return (parseAndTransform(md, file, options).children ?? []).map(stripPositions);
}

/**
 * Parse a Markdown string and return only the inline phrasing content. Used for
 * fields that must be inline (table cells, captions, headings, single-line
 * claims). A single paragraph is unwrapped; otherwise phrasing is flattened
 * across blocks so author input that overshoots an inline context still survives.
 */
export function parseProseInline(
  md: string | undefined,
  file = new VFile(),
  options: ProseTransformOptions = {},
): any[] {
  if (!md) return [];
  const blocks = parseAndTransform(md, file, options).children ?? [];
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

/**
 * Create one page-bound parser. Diagnostics and effective math macros are
 * shared by every ASTRA component rendered into that page.
 */
export function createProseParser(
  file = new VFile(),
  options: ProseTransformOptions = {},
): ProseParser {
  return {
    blocks: (md) => parseProseBlocks(md, file, options),
    inline: (md) => parseProseInline(md, file, options),
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
