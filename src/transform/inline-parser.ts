/**
 * Simple inline markdown parser.
 *
 * Converts a plain string containing **bold**, *italic*, `code`, and [text](url)
 * into MyST AST phrasing content nodes.
 */

import { text, strong, emphasis, inlineCode, link } from './ast-helpers.js';

const INLINE_PATTERN =
  /(`[^`]+`)|(\*\*(?:[^*]|\*(?!\*))+\*\*)|(\*(?:[^*])+\*)|(\[[^\]]+\]\([^)]+\))/;

export function parseInlineMarkdown(input: string): any[] {
  const nodes: any[] = [];
  let remaining = input;

  while (remaining.length > 0) {
    const match = INLINE_PATTERN.exec(remaining);

    if (!match) {
      nodes.push(text(remaining));
      break;
    }

    // Text before the match
    if (match.index > 0) {
      nodes.push(text(remaining.slice(0, match.index)));
    }

    const token = match[0];

    if (match[1]) {
      // `code`
      nodes.push(inlineCode(token.slice(1, -1)));
    } else if (match[2]) {
      // **bold**
      nodes.push(strong([text(token.slice(2, -2))]));
    } else if (match[3]) {
      // *italic*
      nodes.push(emphasis([text(token.slice(1, -1))]));
    } else if (match[4]) {
      // [text](url)
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        nodes.push(link(linkMatch[2], [text(linkMatch[1])]));
      } else {
        nodes.push(text(token));
      }
    }

    remaining = remaining.slice(match.index + token.length);
  }

  return nodes;
}
