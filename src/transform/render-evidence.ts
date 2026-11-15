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
 *     'what kind' concern that already lives on the resolved Output.
 *
 *   Citations as:
 *     **Author et al. (Year)** — [DOI](link)
 *     > "quoted text"
 */

import type { Evidence, Output } from '@astra-spec/sdk';
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
  carrierDiv,
} from './ast-helpers.js';
import { readMetric } from './parse-metric.js';
import type { ProseParser } from './prose.js';
import { fileExt, parseTableData, type TableData } from './parse-table-data.js';
import { reportWarn } from '../diagnostics.js';

/** Resolve an SDK output canonical path to an absolute artifact path. */
export type ArtifactResolver = (outputPath: string) => string | undefined;

/** Options threaded from the plugin surfaces into evidence rendering. */
export interface EvidenceRenderOptions {
  /** Actual bytes for an opaque cited result ID, separate from output refs. */
  resultPath: (resultId: string) => string | undefined;
  /** Absolute artifact path → servable URL (the plugin passes a
   *  source-page-relative mapping so MyST's asset pipeline copies the file). */
  resultUrl: (absPath: string) => string;
  /** The page's vfile — broken references warn through MyST's channel. */
  vfile?: any;
}

/**
 * Render a single evidence item as AST nodes.
 *
 * `outputs` is the result-ID→Output map; artifact
 * evidence dispatches on the referenced output's `type`. Broken
 * references (artifact id not declared) warn through the vfile
 * channel rather than silently rendering nothing.
 *
 * DOI evidence renders as a plain DOI link. Resolving the citation
 * (author–year text, a reference list) is delegated to MyST natively;
 * MySTRA no longer carries its own DOI resolver/cache.
 */
export function renderEvidenceBlock(
  evidence: Evidence,
  outputs: ReadonlyMap<string, Output>,
  prose: ProseParser,
  opts: EvidenceRenderOptions,
): any[] {
  if (evidence.doi) {
    return renderLiteratureEvidence(evidence);
  }
  if (evidence.artifact) {
    return renderArtifactEvidence(evidence, outputs, prose, opts);
  }
  return [];
}

/** The "declared but not produced yet" admonition, shared by every surface. */
function pendingOutput(artifactId: string): any {
  return admonition('warning', [
    admonitionTitle([text('Pending Output')]),
    paragraph([text(`Output "${artifactId}" has not been produced yet.`)]),
  ]);
}

/**
 * A figure output as `container[figure]` (image + caption). Standalone output
 * blocks receive an identifier; evidence figures do not, because one output
 * can support multiple findings.
 */
function figureBlock(
  output: Output,
  artifactId: string,
  url: string,
  prose: ProseParser,
  identifier?: string,
): any[] {
  const figureLabel = output.label ?? artifactId;
  const captionChildren = output.description
    ? prose.inline(output.description)
    : [text(figureLabel)];
  return [
    container(
      'figure',
      [image(url, figureLabel, '100%'), caption([paragraph(captionChildren)])],
      identifier,
    ),
  ];
}

/**
 * Format a DOI as a plain link to `doi.org`. (Citation resolution — a
 * reference list and author–year labels — is MyST's job once a bibliography
 * is wired.)
 */
function formatCiteNode(doi: string): any {
  return link(`https://doi.org/${doi}`, [text(doi)]);
}

/**
 * A DOI cite, optionally preceded by an attributed quote blockquote. Shared by
 * standalone literature evidence and per-insight evidence so both render the
 * same `> "quote"` / `— DOI` shape.
 */
function renderDoiEvidence(doi: string, quote?: { exact: string }): any[] {
  if (quote) {
    return [
      blockquote([paragraph([text(quote.exact)])]),
      paragraph([text('— '), formatCiteNode(doi)]),
    ];
  }
  return [paragraph([formatCiteNode(doi)])];
}

function renderLiteratureEvidence(evidence: Evidence): any[] {
  return renderDoiEvidence(evidence.doi!, evidence.quote);
}

/**
 * Render a single Output as a standalone block (not as evidence under a
 * finding). The `{astra}` directive uses this for addressed outputs.
 *
 * Differences from `renderArtifactEvidence`:
 *   - The figure container carries the `output-<id>` identifier.
 *   - The figure image URL is built via `resultUrl`, which emits the
 *     source-page-relative path MyST hands to its asset pipeline.
 *   - There is no Evidence, so metric/data/report render without a quote.
 *
 * A declared-but-unproduced output renders the same "Pending Output"
 * admonition as evidence rendering.
 */
export function renderOneOutput(
  output: Output,
  artifactId: string,
  results: ArtifactResolver,
  prose: ProseParser,
  opts: Omit<EvidenceRenderOptions, 'resultPath'>,
): any[] {
  const resultPath = results(output.ref);
  const identifier = `output-${artifactId}`;
  if (!resultPath) {
    // Keep the identifier-bearing carrier even before the artifact is
    // produced, because the resolved record still exists for rich themes.
    return [carrierDiv([pendingOutput(artifactId)], identifier)];
  }

  switch (output.type) {
    case 'figure':
      return figureBlock(
        output,
        artifactId,
        opts.resultUrl(resultPath),
        prose,
        identifier,
      );
    case 'table': {
      // Standalone table output: render as a clean, numbered `container[table]`
      // with a caption (not the collapsible `details` used in evidence context).
      const data = parseTableData(resultPath);
      if (data && data.headers.length > 0 && data.rows.length > 0) {
        const tableLabel = output.label ?? artifactId;
        const captionChildren = output.description ? prose.inline(output.description) : [text(tableLabel)];
        return [
          container('table', [tableNodeFromData(data), caption([paragraph(captionChildren)])], identifier),
        ];
      }
      const fallback: any = paragraph([text('Table: '), inlineCode(artifactId)]);
      fallback.identifier = identifier;
      fallback.label = identifier;
      return [fallback];
    }
    case 'metric':
      // One `div` carrier holds the whole neutral fallback (a readable
      // "label: value ± uncertainty unit" sentence), so a rich theme that
      // overrides the carrier renders its big-stat from the publication bundle and
      // replaces the fallback wholesale.
      return [carrierDiv(metricFallback(output, artifactId, resultPath, opts.vfile), identifier)];
    default: {
      // data / report: render inline, then tag the first node as the
      // `output-<id>` carrier.
      const nodes = renderInlineArtifact(output, artifactId, resultPath, undefined, opts.vfile);
      if (nodes.length > 0 && !nodes[0].identifier) {
        nodes[0].identifier = identifier;
        nodes[0].label = identifier;
      }
      return nodes;
    }
  }
}

/**
 * The neutral fallback for a produced metric output: a plain sentence
 * ("**Summary metric:** 1.5 ± 0.3 Mpc") built from the parsed artifact —
 * readable on a stock theme, entirely replaceable by a rich one. A JSON that
 * doesn't parse as a metric shape (scalar / [value, uncertainty] / {value,…})
 * falls back to the tabular rendering the other inline artifact types use.
 */
function metricFallback(
  output: Output,
  artifactId: string,
  resultPath: string,
  vfile?: any,
): any[] {
  const metric = readMetric(resultPath);
  if (metric?.value !== undefined) {
    const parts: any[] = [
      strong([text(`${output.label ?? artifactId}: `)]),
      text(String(metric.value)),
    ];
    const uncertainty = metric.uncertainty;
    if (uncertainty !== undefined && uncertainty !== '') {
      parts.push(text(` \u00B1 ${uncertainty}`));
    }
    const unit = metric.unit;
    if (unit) parts.push(text(` ${unit}`));
    return [paragraph(parts)];
  }
  return renderTabularFile(resultPath, artifactId, output.label ?? artifactId, vfile);
}

function renderArtifactEvidence(
  evidence: Evidence,
  outputs: ReadonlyMap<string, Output>,
  prose: ProseParser,
  opts: EvidenceRenderOptions,
): any[] {
  if (!evidence.cites?.length) return [pendingOutput(evidence.artifact!)];
  return evidence.cites.flatMap((resultId) => {
    const output = outputs.get(resultId);
    const resultPath = opts.resultPath(resultId);
    if (!output || !resultPath) return [pendingOutput(evidence.artifact!)];
    const artifactId = evidence.artifact!;
    switch (output.type) {
      case 'figure':
        return figureBlock(
          output,
          artifactId,
          opts.resultUrl(resultPath),
          prose,
        );
      case 'table':
        return renderTableArtifact(output, artifactId, resultPath, opts.vfile);
      default:
        return renderInlineArtifact(
          output,
          artifactId,
          resultPath,
          evidence,
          opts.vfile,
        );
    }
  });
}

function renderTableArtifact(
  output: Output,
  artifactId: string,
  resultPath: string,
  vfile?: any,
): any[] {
  const tableLabel = output.label ?? artifactId;
  const ext = fileExt(resultPath);
  if (ext === 'json' || ext === 'csv') return renderTabularFile(resultPath, artifactId, tableLabel, vfile);
  // Output declared as a table but the produced artifact isn't
  // a known tabular extension — fall back to a labelled reference.
  return [paragraph([text('Table: '), inlineCode(artifactId)])];
}

function renderInlineArtifact(
  output: Output,
  artifactId: string,
  resultPath: string,
  evidence?: Evidence,
  vfile?: any,
): any[] {
  // Metric / data / report types use the file extension as a hint
  // for tabular display; otherwise emit a labelled reference and
  // (when present) the author's quote as a blockquote.
  const ext = fileExt(resultPath);
  if (ext === 'json' || ext === 'csv') {
    return renderTabularFile(resultPath, artifactId, output.label ?? artifactId, vfile);
  }

  const nodes: any[] = [];
  const refParts: any[] = [
    text('Output: '),
    inlineCode(output.label ?? artifactId),
  ];
  if (evidence?.quote) {
    refParts.push(text(` — "${evidence.quote.exact}"`));
  }
  nodes.push(paragraph(refParts));
  if (evidence?.quote) {
    nodes.push(blockquote([paragraph([text(evidence.quote.exact)])]));
  }
  return nodes;
}

/**
 * Render a JSON or CSV result file as a table inside a collapsible details
 * element (standalone output tables use `tableNodeFromData` directly for a
 * clean render). When the file can't be rendered the fallback depends on the
 * extension: an unrenderable JSON shape is the likely cause for `.json` (so
 * it warns), while a `.csv` that can't be read falls back quietly.
 */
function renderTabularFile(
  filePath: string,
  artifactId: string,
  tableLabel: string,
  vfile?: any,
): any[] {
  const data = parseTableData(filePath);
  if (!data) {
    if (fileExt(filePath) === 'json') {
      reportWarn(
        vfile,
        `JSON output "${artifactId}" did not match a renderable shape (object-of-objects, flat object, or array-of-objects); falling back to a labelled reference.`,
      );
      return [paragraph([text('Output: '), inlineCode(artifactId)])];
    }
    return [paragraph([text(`Could not read ${artifactId}.csv`)])];
  }
  if (data.headers.length === 0 || data.rows.length === 0) {
    return [paragraph([text(`Empty table: ${artifactId}`)])];
  }
  return [details([summary([text(tableLabel)]), tableNodeFromData(data)], false)];
}

/**
 * Build a plain MyST `table` node from parsed `TableData`. Nested-object
 * tables (parseTableData sets `headers[0] === ''`) render the outer key in
 * the first column as bold. No wrapper — callers decide whether to place it
 * in a `details`, a `container[table]`, etc.
 */
const MAX_RENDERED_TABLE_ROWS = 200;

export function tableNodeFromData(data: TableData): any {
  const isNestedObject = data.headers[0] === '';
  const displayHeaders = isNestedObject ? ['', ...data.headers.slice(1)] : data.headers;
  const headerRow = tableRow(
    displayHeaders.map((c) => tableCell([text(c)], true)),
    true,
  );
  const rows = data.rows.slice(0, MAX_RENDERED_TABLE_ROWS).map((row) =>
    tableRow(
      row.map((cell, i) =>
        isNestedObject && i === 0 ? tableCell([strong([text(cell)])]) : tableCell([text(cell)]),
      ),
    ),
  );
  if (data.rows.length > MAX_RENDERED_TABLE_ROWS) {
    rows.push(
      tableRow(
        displayHeaders.map((_, index) =>
          tableCell([text(index === 0 ? `… ${data.rows.length - MAX_RENDERED_TABLE_ROWS} more rows` : '')]),
        ),
      ),
    );
  }
  return table([headerRow, ...rows]);
}

/**
 * Render the evidence body of an insight (caller has already
 * emitted the heading carrying the `<kind>-<id>` identifier). Each
 * piece of evidence is either an attributed quote-with-citation or
 * a bare citation / artifact reference, depending on populated fields.
 *
 *   > "quoted text from paper"
 *   — https://doi.org/…           ← plain DOI link (MyST resolves citations)
 *   > "another quote"
 *   — https://doi.org/…
 *
 * Used by render-findings.ts and the plugin's prior-insight directive;
 * each provides its own carrier heading. Cross-references from
 * option tabs / decisions / narrative point at those carrier ids,
 * not at the body returned here.
 */
export function renderInsightEvidence(
  insight: { evidence?: readonly Evidence[] },
): any[] {
  const nodes: any[] = [];

  for (const ev of insight.evidence ?? []) {
    if (ev.doi) {
      nodes.push(...renderDoiEvidence(ev.doi, ev.quote));
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
