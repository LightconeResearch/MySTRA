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
import Papa from 'papaparse';
import { getCachedMetadata } from '../doi/resolver.js';
import type { ProseParser } from './narrative-parser.js';

/**
 * Render a single evidence item as AST nodes.
 *
 * `doiCacheDir` is the on-disk cache used by `formatCiteNode` for
 * hover-preview metadata. It originates from `projectDir` and is
 * threaded through the transform context (no module-global).
 */
export function renderEvidenceBlock(
  evidence: ASTRAEvidence,
  results: Map<string, string>,
  prose: ProseParser,
  doiCacheDir: string | null,
): any[] {
  if (evidence.doi) {
    return renderLiteratureEvidence(evidence, prose, doiCacheDir);
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
function formatCiteNode(doi: string, doiCacheDir: string | null): any {
  const meta = doiCacheDir ? getCachedMetadata(doi, doiCacheDir) : null;

  if (meta && meta.authorShort) {
    let authorYear = meta.authorShort;
    if (meta.year) authorYear += ` (${meta.year})`;
    return citeGroup([cite(meta.label, [text(authorYear)], 'narrative')], 'narrative');
  }

  // Fallback: plain DOI link
  return link(`https://doi.org/${doi}`, [text(doi)]);
}

function renderLiteratureEvidence(
  evidence: ASTRAEvidence,
  prose: ProseParser,
  doiCacheDir: string | null,
): any[] {
  const nodes: any[] = [];
  const doi = evidence.doi!;

  // Citation + quote as attributed blockquote
  if (evidence.quote) {
    nodes.push(blockquote([
      paragraph([text(evidence.quote.exact)]),
    ]));
    nodes.push(paragraph([text('\u2014 '), formatCiteNode(doi, doiCacheDir)]));
  } else {
    nodes.push(paragraph([formatCiteNode(doi, doiCacheDir)]));
  }

  // Figure/table references. The label ("Fig. 3", "Table 2") is a
  // short renderer-functional handle and stays plain text; the
  // caption / region come from the author and parse as prose with
  // anchor resolution. Em-dash separators are kept as their own
  // inline `text` pieces so the parsed prose stays clean.
  if (evidence.figure) {
    const parts: any[] = [emphasis([text(`See ${evidence.figure.label}`)])];
    if (evidence.figure.caption) {
      parts.push(text(' \u2014 '), ...prose.inline(evidence.figure.caption));
    }
    nodes.push(paragraph(parts));
  }
  if (evidence.table) {
    const parts: any[] = [emphasis([text(`See ${evidence.table.label}`)])];
    if (evidence.table.caption) {
      parts.push(text(' \u2014 '), ...prose.inline(evidence.table.caption));
    }
    if (evidence.table.region) {
      parts.push(text(' '), ...prose.inline(evidence.table.region));
    }
    nodes.push(paragraph(parts));
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

      // The `output-<id>` xref carrier lives on the per-output row
      // (renderOutputsTable). The figure container is the visual
      // rendering of the artifact wherever it's referenced as
      // evidence; a single output may be cited by multiple findings,
      // so the figure no longer carries the structural identifier.
      nodes.push(
        container('figure', [
          image(`/static/${artifactId}.${ext}`, figureLabel, '100%'),
          caption([paragraph(prose.inline(captionText))]),
        ]),
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

  // papaparse provides a sync parse; the package is the same one
  // listed in package.json — imported at top of file as ESM.
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
 * Render the evidence body of an insight (caller has already
 * emitted the heading carrying the `<kind>-<id>` identifier). Each
 * piece of evidence is either an attributed quote-with-citation or
 * a bare citation / artifact reference, depending on populated fields.
 *
 *   > "quoted text from paper"
 *   — Author et al. (Year)        ← cite node with hover preview
 *   > "another quote"
 *   — Author2 et al. (Year)
 *
 * Used by both render-findings.ts and render-prior-insights.ts;
 * each provides its own carrier heading. Cross-references from
 * option tabs / decisions / narrative point at those carrier ids,
 * not at the body returned here.
 */
export function renderInsightEvidence(
  insight: { evidence: ASTRAEvidence[] },
  doiCacheDir: string | null,
): any[] {
  const nodes: any[] = [];

  for (const ev of insight.evidence) {
    if (ev.doi) {
      if (ev.quote) {
        // Quote → attribution pattern
        nodes.push(blockquote([
          paragraph([text(ev.quote.exact)]),
        ]));
        nodes.push(paragraph([text('\u2014 '), formatCiteNode(ev.doi, doiCacheDir)]));
      } else {
        // No quote, just cite the source
        nodes.push(paragraph([formatCiteNode(ev.doi, doiCacheDir)]));
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
