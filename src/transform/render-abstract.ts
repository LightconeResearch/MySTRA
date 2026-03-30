/**
 * Renders the analysis description.
 */

import type { ASTRAAnalysis } from '../types/astra.js';
import { paragraph, text } from './ast-helpers.js';

export function renderAbstract(analysis: ASTRAAnalysis): any[] {
  const nodes: any[] = [];

  if (analysis.description) {
    const paragraphs = analysis.description.split('\n\n').filter(Boolean);
    for (const p of paragraphs) {
      nodes.push(paragraph([text(p.trim())]));
    }
  }

  return nodes;
}
