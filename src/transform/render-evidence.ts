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
  details,
  summary,
  admonition,
  admonitionTitle,
  link,
  inlineCode,
  table,
  tableRow,
  tableCell,
  cite,
  citeGroup,
} from './ast-helpers.js';
import { parse as parsePath } from 'node:path';
import { readFileSync } from 'node:fs';
import { getCachedMetadata } from '../doi/resolver.js';
import type { ProseParser } from './narrative-parser.js';

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
  prose: ProseParser,
): any[] {
  if (evidence.doi) {
    return renderLiteratureEvidence(evidence);
  }
  if (evidence.artifact) {
    return renderArtifactEvidence(evidence, results, prose);
  }
  return [];
}

/**
 * Format a DOI citation as a cite node for hover previews.
 * Returns a single citeGroup node that the book-theme renders
 * with a hover tooltip showing the full citation.
 * Falls back to a plain DOI link if not resolved.
 */
function formatCiteNode(doi: string): any {
  const meta = _doiCacheDir ? getCachedMetadata(doi, _doiCacheDir) : null;

  if (meta && meta.authorShort) {
    let authorYear = meta.authorShort;
    if (meta.year) authorYear += ` (${meta.year})`;
    return citeGroup([cite(meta.label, [text(authorYear)], 'narrative')], 'narrative');
  }

  // Fallback: plain DOI link
  return link(`https://doi.org/${doi}`, [text(doi)]);
}

function renderLiteratureEvidence(evidence: ASTRAEvidence): any[] {
  const nodes: any[] = [];
  const doi = evidence.doi!;

  // Citation + quote as attributed blockquote
  if (evidence.quote) {
    nodes.push(blockquote([
      paragraph([text(evidence.quote.exact)]),
    ]));
    nodes.push(paragraph([text('\u2014 '), formatCiteNode(doi)]));
  } else {
    nodes.push(paragraph([formatCiteNode(doi)]));
  }

  // Figure/table references
  if (evidence.figure) {
    nodes.push(
      paragraph([
        emphasis([text(`See ${evidence.figure.label}`)]),
        ...(evidence.figure.caption ? [text(` \u2014 ${evidence.figure.caption}`)] : []),
      ]),
    );
  }
  if (evidence.table) {
    const tableParts: any[] = [emphasis([text(`See ${evidence.table.label}`)])];
    if (evidence.table.caption) tableParts.push(text(` \u2014 ${evidence.table.caption}`));
    if (evidence.table.region) tableParts.push(text(` (${evidence.table.region})`));
    nodes.push(paragraph(tableParts));
  }

  return nodes;
}

function renderArtifactEvidence(
  evidence: ASTRAEvidence,
  results: Map<string, string>,
  prose: ProseParser,
): any[] {
  const nodes: any[] = [];
  const artifactId = evidence.artifact!;
  const resultPath = results.get(artifactId);

  if (resultPath) {
    const ext = parsePath(resultPath).ext.slice(1).toLowerCase();

    if (['png', 'jpg', 'jpeg', 'svg'].includes(ext)) {
      const figureLabel = evidence.figure?.label ?? artifactId;
      const captionText = evidence.figure?.caption ?? evidence.quote?.exact ?? artifactId;

      // Identifier follows the structural-element scheme so
      // `#outputs.<id>` resolves to the materialized figure.
      nodes.push(
        container('figure', [
          image(`/static/${artifactId}.${ext}`, figureLabel, '100%'),
          caption([paragraph(prose.inline(captionText))]),
        ], `output-${artifactId}`),
      );
    } else if (ext === 'json') {
      nodes.push(...renderJSONTable(resultPath, artifactId, evidence));
    } else if (ext === 'csv') {
      nodes.push(...renderCSVTable(resultPath, artifactId, evidence));
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
 * Render a JSON result file as a table inside a collapsible details element.
 * Supports nested object structures: outer keys → rows, inner keys → columns.
 */
function renderJSONTable(
  filePath: string,
  artifactId: string,
  evidence: ASTRAEvidence,
): any[] {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return [paragraph([text(`Could not parse ${artifactId}.json`)])];
  }

  const tableLabel = evidence.table?.label ?? evidence.figure?.label ?? artifactId;

  // Handle nested object: { key: { col1: val, col2: val }, ... }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return [];

    // Collect all inner keys across all entries for column headers
    const colSet = new Set<string>();
    for (const [, value] of entries) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const k of Object.keys(value as Record<string, unknown>)) {
          colSet.add(k);
        }
      }
    }
    const columns = Array.from(colSet);

    if (columns.length === 0) {
      // Flat object: { key: value, ... } → two-column table
      const headerRow = tableRow(
        [tableCell([text('Key')], true), tableCell([text('Value')], true)],
        true,
      );
      const rows = entries.map(([k, v]) =>
        tableRow([tableCell([text(k)]), tableCell([text(formatValue(v))])]),
      );
      return [details([summary([text(tableLabel)]), table([headerRow, ...rows])], false)];
    }

    // Nested object → multi-column table
    const headerRow = tableRow(
      [tableCell([text('')], true), ...columns.map((c) => tableCell([text(c)], true))],
      true,
    );
    const rows = entries.map(([key, value]) => {
      const record = (value && typeof value === 'object' && !Array.isArray(value))
        ? value as Record<string, unknown>
        : {};
      return tableRow([
        tableCell([strong([text(key)])]),
        ...columns.map((col) => tableCell([text(formatValue(record[col]))])),
      ]);
    });

    return [details([summary([text(tableLabel)]), table([headerRow, ...rows])], false)];
  }

  // Handle array of objects: [{ col1: val, col2: val }, ...]
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    const columns = Object.keys(data[0] as Record<string, unknown>);
    const headerRow = tableRow(
      columns.map((c) => tableCell([text(c)], true)),
      true,
    );
    const rows = data.map((item: Record<string, unknown>) =>
      tableRow(columns.map((col) => tableCell([text(formatValue(item[col]))]))),
    );
    return [details([summary([text(tableLabel)]), table([headerRow, ...rows])], false)];
  }

  return [paragraph([text(`Output: `), inlineCode(artifactId)])];
}

/**
 * Render a CSV result file as a table inside a collapsible details element.
 */
function renderCSVTable(
  filePath: string,
  artifactId: string,
  evidence: ASTRAEvidence,
): any[] {
  let csvText: string;
  try {
    csvText = readFileSync(filePath, 'utf-8');
  } catch {
    return [paragraph([text(`Could not read ${artifactId}.csv`)])];
  }

  // Dynamic import would be cleaner but we need sync; papaparse supports sync parse
  const Papa = require('papaparse');
  const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });

  if (!result.data || result.data.length === 0) {
    return [paragraph([text(`Empty CSV: ${artifactId}`)])];
  }

  const tableLabel = evidence.table?.label ?? artifactId;
  const columns = result.meta.fields as string[];
  const headerRow = tableRow(
    columns.map((c: string) => tableCell([text(c)], true)),
    true,
  );
  const rows = (result.data as Record<string, string>[]).map((row) =>
    tableRow(columns.map((col: string) => tableCell([text(row[col] ?? '')]))),
  );

  return [details([summary([text(tableLabel)]), table([headerRow, ...rows])], false)];
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '\u2014';
  if (typeof val === 'number') {
    if (Number.isNaN(val)) return 'NaN';
    return Number.isInteger(val) ? val.toString() : val.toPrecision(6);
  }
  if (Array.isArray(val)) {
    return val.map((v) => formatValue(v)).join(', ');
  }
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/**
 * Render a single insight as a claim supported by evidence.
 *
 * Structure:
 *   **Insight claim text**
 *   > "quoted text from paper"
 *   — Author et al. (Year)        ← cite node with hover preview
 *   > "another quote"
 *   — Author2 et al. (Year)
 */
export function renderInsight(
  insightId: string,
  allInsights: Record<string, { claim: string; evidence: ASTRAEvidence[] }>,
  prose: ProseParser,
  kind: 'prior_insight' | 'finding' = 'prior_insight',
): any[] {
  const insight = allInsights[insightId];
  if (!insight) return [];

  const nodes: any[] = [];

  // Insight claim as bold headline; parsed as inline Markdown so
  // emphasis/code/anchor links inside claims render and resolve.
  // The identifier on the headline paragraph makes the insight
  // addressable as `<kind>-<id>` (prior_insight-<id> by default,
  // finding-<id> when called from the findings renderer).
  const headline: any = paragraph([strong(prose.inline(insight.claim))]);
  headline.identifier = `${kind}-${insightId}`;
  headline.label = headline.identifier;
  nodes.push(headline);

  // Each piece of evidence: attributed quote from a source
  for (const ev of insight.evidence) {
    if (ev.doi) {
      if (ev.quote) {
        // Quote → attribution pattern
        nodes.push(blockquote([
          paragraph([text(ev.quote.exact)]),
        ]));
        nodes.push(paragraph([text('\u2014 '), formatCiteNode(ev.doi)]));
      } else {
        // No quote, just cite the source
        nodes.push(paragraph([formatCiteNode(ev.doi)]));
      }
    } else if (ev.artifact) {
      if (ev.quote) {
        nodes.push(blockquote([paragraph([text(ev.quote.exact)])]));
        nodes.push(paragraph([text('\u2014 '), inlineCode(ev.artifact)]));
      } else {
        nodes.push(paragraph([text('From output: '), inlineCode(ev.artifact)]));
      }
    }
  }

  return nodes;
}
