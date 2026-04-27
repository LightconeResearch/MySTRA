/**
 * Renders the Analysis narrative as the page abstract.
 *
 * `Analysis.narrative` is a structured object with five optional Markdown
 * sections (summary, findings, methods, inputs, outputs). For the page
 * abstract we render only the summary section — the other four are
 * surfaced as their corresponding structural sections (Findings, Methods,
 * Data Sources, Outputs) elsewhere on the page, so re-printing them as
 * abstract prose would duplicate content.
 *
 * Section content is Markdown with anchor links of the form
 * `[text](#path.to.element)` per the v0.0.6 narrative grammar; both
 * Markdown parsing and anchor → crossReference resolution live in
 * `narrative-parser.ts`.
 */

import type { ASTRAAnalysis } from '../types/astra.js';
import {
  parseNarrativeMarkdown,
  resolveNarrativeAnchors,
} from './narrative-parser.js';

export function renderAbstract(
  analysis: ASTRAAnalysis,
  slug: string,
): any[] {
  return renderNarrativeSection(analysis.narrative?.summary, analysis, slug);
}

/**
 * Render one narrative section (raw Markdown string) into mdast,
 * resolving in-scope anchor links to crossReferences.
 */
export function renderNarrativeSection(
  md: string | undefined,
  analysis: ASTRAAnalysis,
  slug: string,
): any[] {
  if (!md) return [];
  return resolveNarrativeAnchors(parseNarrativeMarkdown(md), analysis, slug);
}
