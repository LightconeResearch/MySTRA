/**
 * Renders evidence blocks with rich DOI citation formatting.
 *
 * Uses the DOI cache to format citations as:
 * **Author et al. (Year)** — [DOI](link)
 * > "quoted text"
 */

import type { ASTRAEvidence } from '../types/astra.js';
import {
  paragraph,
  text,
  strong,
  emphasis,
  blockquote,
  image,
  container,
  caption,
  admonition,
  admonitionTitle,
  link,
  inlineCode,
} from './ast-helpers.js';
import { parse as parsePath } from 'node:path';
import { getCachedMetadata } from '../doi/resolver.js';

/** DOI cache dir, set by the transform entry point */
let _doiCacheDir: string | null = null;

export function setDOICacheDir(dir: string) {
  _doiCacheDir = dir;
}

/**
 * Render a single evidence item as AST nodes.
 */
export function renderEvidenceBlock(
  evidence: ASTRAEvidence,
  results: Map<string, string>,
): any[] {
  if (evidence.doi) {
    return renderLiteratureEvidence(evidence);
  }
  if (evidence.artifact) {
    return renderArtifactEvidence(evidence, results);
  }
  return [];
}

/**
 * Format a DOI citation inline using cached metadata.
 * Returns: **Author et al. (Year)** — [DOI](link) (p. N)
 * Falls back to raw DOI if not resolved.
 */
function formatDOICitation(doi: string, page?: number): any[] {
  const meta = _doiCacheDir ? getCachedMetadata(doi, _doiCacheDir) : null;

  const parts: any[] = [];

  if (meta && meta.authorShort) {
    // Rich format: **Author et al. (Year)** — DOI link
    let authorYear = meta.authorShort;
    if (meta.year) authorYear += ` (${meta.year})`;
    parts.push(strong([text(authorYear)]));
    parts.push(text(' — '));
    parts.push(link(`https://doi.org/${doi}`, [text(doi)]));
  } else {
    // Fallback: just DOI link
    parts.push(link(`https://doi.org/${doi}`, [text(doi)]));
  }

  if (page) {
    parts.push(text(` (p. ${page})`));
  }

  return parts;
}

function renderLiteratureEvidence(evidence: ASTRAEvidence): any[] {
  const nodes: any[] = [];
  const doi = evidence.doi!;
  const page = evidence.location?.page;

  // Citation line
  nodes.push(paragraph(formatDOICitation(doi, page)));

  // Quote
  if (evidence.quote) {
    nodes.push(blockquote([paragraph([text(evidence.quote.exact)])]));
  }

  // Figure/table references
  if (evidence.figure) {
    nodes.push(
      paragraph([
        emphasis([text(`See ${evidence.figure.label}`)]),
        ...(evidence.figure.caption ? [text(` — ${evidence.figure.caption}`)] : []),
      ]),
    );
  }
  if (evidence.table) {
    const tableParts: any[] = [emphasis([text(`See ${evidence.table.label}`)])];
    if (evidence.table.caption) tableParts.push(text(` — ${evidence.table.caption}`));
    if (evidence.table.region) tableParts.push(text(` (${evidence.table.region})`));
    nodes.push(paragraph(tableParts));
  }

  return nodes;
}

function renderArtifactEvidence(
  evidence: ASTRAEvidence,
  results: Map<string, string>,
): any[] {
  const nodes: any[] = [];
  const artifactId = evidence.artifact!;
  const resultPath = results.get(artifactId);

  if (resultPath) {
    const ext = parsePath(resultPath).ext.slice(1).toLowerCase();

    if (['png', 'jpg', 'jpeg', 'svg'].includes(ext)) {
      const figureLabel = evidence.figure?.label ?? artifactId;
      const captionText = evidence.figure?.caption ?? evidence.quote?.exact ?? artifactId;

      nodes.push(
        container('figure', [
          image(`/static/${artifactId}.${ext}`, figureLabel),
          caption([paragraph([text(captionText)])]),
        ], `fig-${artifactId}`),
      );
    } else {
      const refParts: any[] = [
        text('Output: '),
        inlineCode(artifactId),
      ];
      if (evidence.quote) {
        refParts.push(text(` — "${evidence.quote.exact}"`));
      }
      nodes.push(paragraph(refParts));

      if (evidence.quote) {
        nodes.push(blockquote([paragraph([text(evidence.quote.exact)])]));
      }
    }
  } else {
    nodes.push(
      admonition('warning', [
        admonitionTitle([text('Pending Output')]),
        paragraph([text(`Output "${artifactId}" has not been produced yet.`)]),
      ]),
    );
  }

  return nodes;
}

/**
 * Render all evidence from an insight (used by render-methods for option evidence).
 * Uses rich DOI formatting when available.
 */
export function renderInsightEvidence(
  insightId: string,
  allInsights: Record<string, { claim: string; evidence: ASTRAEvidence[] }>,
): any[] {
  const insight = allInsights[insightId];
  if (!insight) return [];

  const nodes: any[] = [];

  for (const ev of insight.evidence) {
    if (ev.doi) {
      const page = ev.location?.page;

      // Rich citation line
      nodes.push(paragraph(formatDOICitation(ev.doi, page)));

      if (ev.quote) {
        nodes.push(blockquote([paragraph([text(ev.quote.exact)])]));
      }
      if (ev.figure) {
        nodes.push(paragraph([emphasis([text(`See ${ev.figure.label}`)])]));
      }
      if (ev.table) {
        nodes.push(paragraph([emphasis([text(`See ${ev.table.label}`)])]));
      }
    } else if (ev.artifact) {
      nodes.push(paragraph([text('From output: '), inlineCode(ev.artifact)]));
      if (ev.quote) {
        nodes.push(blockquote([paragraph([text(ev.quote.exact)])]));
      }
    }
  }

  return nodes;
}
