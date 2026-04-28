/**
 * Renders evidence blocks.
 *
 * Source-of-truth split:
 *   - DOI evidence: cited via the citation pipeline (cite + hover
 *     metadata if cached; plain DOI link otherwise).
 *   - Artifact evidence: looks up the referenced output in the
 *     analysis's `outputs` map. The output's `type` drives how the
 *     artifact renders; `label` and `description` carry the
 *     caption-equivalent metadata. There is no separate
 *     figure/table selector on Evidence — those would conflate the
 *     'what kind' concern that already lives on Output (astra-spec
 *     v0.0.6 OutputType: metric / figure / table / data / report).
 *
 *   Citations as:
 *     **Author et al. (Year)** — [DOI](link)
 *     > "quoted text"
 */

import type { ASTRAEvidence, ASTRAOutput } from '../types/astra.js';
import {
  paragraph,
  text,
  strong,
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
 * `outputs` is the host analysis's id→Output map; artifact
 * evidence dispatches on the referenced output's `type`. Broken
 * references (artifact id not declared) emit a console.warn
 * rather than silently rendering nothing.
 *
 * `doiCacheDir` is the on-disk cache used by `formatCiteNode` for
 * hover-preview metadata. Threaded through the transform context;
 * `null` falls back to a plain DOI link.
 */
export function renderEvidenceBlock(
  evidence: ASTRAEvidence,
  results: Map<string, string>,
  outputs: Map<string, ASTRAOutput>,
  prose: ProseParser,
  doiCacheDir: string | null,
): any[] {
  if (evidence.doi) {
    return renderLiteratureEvidence(evidence, doiCacheDir);
  }
  if (evidence.artifact) {
    return renderArtifactEvidence(evidence, results, outputs, prose);
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
  doiCacheDir: string | null,
): any[] {
  const nodes: any[] = [];
  const doi = evidence.doi!;

  // Citation + quote as attributed blockquote. There is no
  // figure/table selector on Evidence in astra-spec v0.0.6 — the
  // author cites a paper here; if they want to point at a specific
  // figure or table, narrative prose ("see Figure 3 in [Smith
  // (2020)](#findings.foo)") is the route.
  if (evidence.quote) {
    nodes.push(blockquote([
      paragraph([text(evidence.quote.exact)]),
    ]));
    nodes.push(paragraph([text('— '), formatCiteNode(doi, doiCacheDir)]));
  } else {
    nodes.push(paragraph([formatCiteNode(doi, doiCacheDir)]));
  }

  return nodes;
}

function renderArtifactEvidence(
  evidence: ASTRAEvidence,
  results: Map<string, string>,
  outputs: Map<string, ASTRAOutput>,
  prose: ProseParser,
): any[] {
  const nodes: any[] = [];
  const artifactId = evidence.artifact!;
  const output = outputs.get(artifactId);

  if (!output) {
    // Broken reference — the evidence points at an artifact id
    // that's not declared in `analysis.outputs`. Surface it instead
    // of silently dropping; downstream tooling can lint for these.
    console.warn(
      `[mystra] Evidence references unknown output id "${artifactId}" — broken reference dropped from output.`,
    );
    return nodes;
  }

  const resultPath = results.get(artifactId);
  if (!resultPath) {
    // Output is declared but the artifact file hasn't been produced
    // yet. Render a "Pending Output" admonition so the page makes
    // the absence visible.
    nodes.push(
      admonition('warning', [
        admonitionTitle([text('Pending Output')]),
        paragraph([text(`Output "${artifactId}" has not been produced yet.`)]),
      ]),
    );
    return nodes;
  }

  // Output declared and produced — dispatch on Output.type. label /
  // description on the Output carry the caption-equivalent metadata
  // that previously lived on Evidence.figure / Evidence.table; the
  // selector types are gone.
  switch (output.type) {
    case 'figure':
      nodes.push(...renderFigureArtifact(output, artifactId, resultPath, prose));
      break;
    case 'table':
      nodes.push(...renderTableArtifact(output, artifactId, resultPath));
      break;
    case 'metric':
    case 'data':
    case 'report':
      nodes.push(...renderInlineArtifact(output, evidence, artifactId, resultPath));
      break;
  }

  return nodes;
}

function renderFigureArtifact(
  output: ASTRAOutput,
  artifactId: string,
  resultPath: string,
  prose: ProseParser,
): any[] {
  const ext = parsePath(resultPath).ext.slice(1).toLowerCase();
  // The `output-<id>` xref carrier lives on the per-output row
  // (renderOutputsTable). The figure container is the visual
  // rendering wherever the artifact is referenced as evidence; a
  // single output may be cited by multiple findings, so the
  // figure no longer carries the structural identifier.
  const figureLabel = output.label ?? artifactId;
  const captionChildren = output.description
    ? prose.inline(output.description)
    : [text(figureLabel)];
  return [
    container('figure', [
      image(`/static/${artifactId}.${ext}`, figureLabel, '100%'),
      caption([paragraph(captionChildren)]),
    ]),
  ];
}

function renderTableArtifact(
  output: ASTRAOutput,
  artifactId: string,
  resultPath: string,
): any[] {
  const ext = parsePath(resultPath).ext.slice(1).toLowerCase();
  const tableLabel = output.label ?? artifactId;
  if (ext === 'json') return renderJSONTable(resultPath, artifactId, tableLabel);
  if (ext === 'csv') return renderCSVTable(resultPath, artifactId, tableLabel);
  // Output declared as a table but the produced artifact isn't
  // a known tabular extension — fall back to a labelled reference.
  return [paragraph([text('Table: '), inlineCode(artifactId)])];
}

function renderInlineArtifact(
  output: ASTRAOutput,
  evidence: ASTRAEvidence,
  artifactId: string,
  resultPath: string,
): any[] {
  const ext = parsePath(resultPath).ext.slice(1).toLowerCase();
  // Metric / data / report types use the file extension as a hint
  // for tabular display; otherwise emit a labelled reference and
  // (when present) the author's quote as a blockquote.
  if (ext === 'json') {
    return renderJSONTable(resultPath, artifactId, output.label ?? artifactId);
  }
  if (ext === 'csv') {
    return renderCSVTable(resultPath, artifactId, output.label ?? artifactId);
  }

  const nodes: any[] = [];
  const refParts: any[] = [
    text('Output: '),
    inlineCode(output.label ?? artifactId),
  ];
  if (evidence.quote) {
    refParts.push(text(` — "${evidence.quote.exact}"`));
  }
  nodes.push(paragraph(refParts));
  if (evidence.quote) {
    nodes.push(blockquote([paragraph([text(evidence.quote.exact)])]));
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
  tableLabel: string,
): any[] {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return [paragraph([text(`Could not parse ${artifactId}.json`)])];
  }

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

  // Parsed but didn't match a known shape (object-of-objects, flat
  // object, array-of-objects). Surface it the same way an unknown
  // artifact id is surfaced — silent fallback hides misconfigured
  // outputs from operators.
  console.warn(
    `[mystra] JSON output "${artifactId}" did not match a renderable shape (object-of-objects, flat object, or array-of-objects); falling back to a labelled reference.`,
  );
  return [paragraph([text(`Output: `), inlineCode(artifactId)])];
}

/**
 * Render a CSV result file as a table inside a collapsible details element.
 */
function renderCSVTable(
  filePath: string,
  artifactId: string,
  tableLabel: string,
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
  if (val === null || val === undefined) return '—';
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
        nodes.push(paragraph([text('— '), formatCiteNode(ev.doi, doiCacheDir)]));
      } else {
        // No quote, just cite the source
        nodes.push(paragraph([formatCiteNode(ev.doi, doiCacheDir)]));
      }
    } else if (ev.artifact) {
      if (ev.quote) {
        nodes.push(blockquote([paragraph([text(ev.quote.exact)])]));
        nodes.push(paragraph([text('— '), inlineCode(ev.artifact)]));
      } else {
        nodes.push(paragraph([text('From output: '), inlineCode(ev.artifact)]));
      }
    }
  }

  return nodes;
}
