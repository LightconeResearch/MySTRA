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
 * Section content is Markdown and may contain anchor links of the form
 * `[text](#path.to.element)`; full parsing with anchor → crossReference
 * resolution lands in a follow-up commit. For now we split on blank
 * lines and emit plain-text paragraphs.
 */

import type { ASTRAAnalysis, ASTRANarrative } from '../types/astra.js';
import { paragraph, text } from './ast-helpers.js';

export function renderAbstract(analysis: ASTRAAnalysis): any[] {
  return renderNarrativeSummary(analysis.narrative);
}

export function renderNarrativeSummary(
  narrative: ASTRANarrative | undefined,
): any[] {
  if (!narrative?.summary) return [];
  return narrative.summary
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => paragraph([text(p)]));
}
