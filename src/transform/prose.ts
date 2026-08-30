/**
 * The prose engine: parse the Markdown embedded in ASTRA *components*.
 *
 * Every Markdown field on a component — `Insight.claim`, `Decision.rationale`,
 * `Option/Input/Output.description`, captions, finding notes — flows through
 * `myst-parser`, so MySTRA stays MyST-native and emits the same `mdast` themes
 * consume.
 *
 * Prose is MyST Markdown, except for host-session features (MDAST imports,
 * includes, raw directives, and execution) that cannot run after MyST reaches
 * document plugins. ASTRA does not define an in-prose element reference syntax
 * (RFC-0002 left prose fields free-form); referencing is done from the report
 * side via the `{astra}` role/directive surfaces.
 */

import { mystParse } from 'myst-parser';
import {
  basicTransformations,
  htmlTransform,
  inlineMathSimplificationTransform,
  mathTransform,
  reconstructHtmlTransform,
} from 'myst-transforms';
import { fileError } from 'myst-common';
import { VFile } from 'vfile';
import type { MystMathMacros } from '../myst-config.js';

// ── Parsing ───────────────────────────────────────────────────────

export interface ProseTransformOptions {
  macros?: MystMathMacros;
  firstDepth?: number;
}

type UnsupportedProse = 'mdast' | 'include' | 'raw' | 'execution';
type UnsupportedProseMatch = { kind: UnsupportedProse; node: any };

function unsupportedProseNode(node: any): UnsupportedProseMatch | undefined {
  if (node?.type === 'mdast' || (node?.type === 'mystDirective' && node.name === 'mdast')) {
    return { kind: 'mdast', node };
  }
  if (node?.type === 'include' || (node?.type === 'mystDirective' && node.name === 'include')) {
    return { kind: 'include', node };
  }
  if (node?.type === 'raw' || (node?.type === 'mystDirective' && node.name === 'raw')) {
    return { kind: 'raw', node };
  }
  if (
    node?.type === 'inlineExpression' ||
    (node?.type === 'code' && node.executable === true) ||
    (node?.type === 'block' && node.kind === 'notebook-code') ||
    (node?.type === 'mystDirective' && node.name === 'code-cell') ||
    (node?.type === 'mystRole' && node.name === 'eval')
  ) {
    return { kind: 'execution', node };
  }
  if (!Array.isArray(node?.children)) return undefined;
  for (const child of node.children) {
    const unsupported = unsupportedProseNode(child);
    if (unsupported) return unsupported;
  }
  return undefined;
}

function unsupportedMessage(kind: UnsupportedProse): string {
  const construct = kind === 'mdast'
    ? 'the {mdast} directive'
    : kind === 'include'
      ? 'the {include} directive'
      : kind === 'raw'
        ? 'the {raw} directive'
        : 'executable code or {eval}';
  return (
    `ASTRA component prose cannot use ${construct}: MyST runs that feature before ` +
    'document-stage plugins. Move it to the host page instead.'
  );
}

function parseHtml(content: string, file: VFile): any {
  const tree = mystParse(content, { vfile: file });
  reconstructHtmlTransform(tree);
  htmlTransform(tree);
  return tree;
}

function unsupportedFallback(
  md: string,
  file: VFile,
  unsupported: UnsupportedProseMatch,
): any {
  fileError(file, unsupportedMessage(unsupported.kind), {
    node: unsupported.node,
    source: 'mystra',
  });
  // A strict build fails on the diagnostic. Non-strict renderers still get a
  // safe, readable representation rather than an unresolved MyST node.
  return { type: 'root', children: [{ type: 'code', lang: 'markdown', value: md }] };
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
  const unsupported = unsupportedProseNode(parsed);
  if (unsupported) return unsupportedFallback(md, file, unsupported);
  reconstructHtmlTransform(parsed);
  htmlTransform(parsed);
  const sentinel: any = {
    type: 'block',
    children: parsed.children ?? [],
  };
  const fragment: any = {
    type: 'root',
    children: [sentinel],
  };
  basicTransformations(fragment, file, {
    parser: (content: string) => parseHtml(content, file),
    ...(options.firstDepth == null ? {} : { firstDepth: options.firstDepth }),
  });
  // Basic transforms parse block metadata and can therefore introduce a role
  // or directive that was not present as a node in the initial parse.
  const introduced = unsupportedProseNode(fragment);
  if (introduced) return unsupportedFallback(md, file, introduced);
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
  blocks(md: string | undefined, firstDepth?: number): any[];
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
    blocks: (md, firstDepth) => parseProseBlocks(md, file, {
      ...options,
      ...(firstDepth == null ? {} : { firstDepth }),
    }),
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
