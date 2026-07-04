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
} from './ast-helpers.js';
import type { ArtifactResolver } from '../loader.js';
import type { ProseParser } from './prose.js';
import { fileExt, parseTableData, type TableData } from './parse-table-data.js';
import { reportWarn } from '../diagnostics.js';

/** Options threaded from the plugin surfaces into evidence rendering. */
export interface EvidenceRenderOptions {
  /** Absolute artifact path → servable URL (the plugin passes a
   *  project-relative mapping so MyST's asset pipeline copies the file). */
  resultUrl?: (absPath: string) => string;
  /** The page's vfile — broken references warn through MyST's channel. */
  vfile?: any;
}

/**
 * Render a single evidence item as AST nodes.
 *
 * `outputs` is the host analysis's id→Output map; artifact
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
  results: ArtifactResolver,
  outputs: Map<string, Output>,
  prose: ProseParser,
  opts?: EvidenceRenderOptions,
): any[] {
  if (evidence.doi) {
    return renderLiteratureEvidence(evidence);
  }
  if (evidence.artifact) {
    return renderArtifactEvidence(evidence, results, outputs, prose, opts);
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
 * The servable URL of a produced artifact. Callers with a real URL mapping
 * (the plugin) pass `resultUrl`; without one the legacy content-server
 * `/static/<id>.<ext>` scheme is the fallback — this is the only place that
 * scheme exists.
 */
function artifactUrl(
  artifactId: string,
  resultPath: string,
  resultUrl?: (absPath: string) => string,
): string {
  return resultUrl ? resultUrl(resultPath) : `/static/${artifactId}.${fileExt(resultPath)}`;
}

/**
 * A figure output as `container[figure]` (image + caption). The identifier
 * is set only in directive context — in evidence context the `output-<id>`
 * xref carrier lives on the per-output registry row, since a single output
 * may be cited by multiple findings.
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
 * reference list, author–year labels — is MyST's job once a bibliography
 * is wired; see SPEC.md §6.)
 */
function formatCiteNode(doi: string): any {
  return link(`https://doi.org/${doi}`, [text(doi)]);
}

/**
 * A DOI cite, optionally preceded by an attributed quote blockquote. Shared by
 * standalone literature evidence and per-insight evidence so both render the
 * same `> "quote"` / `— DOI` shape. There is no figure/table selector on
 * Evidence in astra-spec v0.0.6 — the author cites a paper here; to point at a
 * specific figure, narrative prose ("see Figure 3 in [Smith (2020)](…)") is the
 * route.
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
 * finding). Used by the `astra:output` MyST directive: an author imports
 * one output by id and gets the figure / table / metric rendering inline
 * in their prose.
 *
 * Differences from `renderArtifactEvidence`:
 *   - The figure container carries the `output-<id>` identifier so the
 *     block is the cross-reference anchor (in evidence context the table
 *     row is the carrier; in directive context the rich block is).
 *   - The figure image URL is built via the optional `resultUrl` callback
 *     so callers outside the content server (the plugin) can emit a real
 *     project-relative path instead of the `/static/<basename>` mount.
 *     Defaults to the `/static/` scheme when no callback is given.
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
  opts?: EvidenceRenderOptions,
): any[] {
  const resultPath = results(artifactId);
  if (!resultPath) {
    return [pendingOutput(artifactId)];
  }

  const identifier = `output-${artifactId}`;

  switch (output.type) {
    case 'figure':
      return figureBlock(
        output,
        artifactId,
        artifactUrl(artifactId, resultPath, opts?.resultUrl),
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
    default: {
      // metric / data / report: render inline, then tag the first node with
      // the `output-<id>` carrier so cross-references resolve to it.
      const nodes = renderInlineArtifact(output, artifactId, resultPath, undefined, opts?.vfile);
      if (nodes.length > 0 && !nodes[0].identifier) {
        nodes[0].identifier = identifier;
        nodes[0].label = identifier;
      }
      return nodes;
    }
  }
}

function renderArtifactEvidence(
  evidence: Evidence,
  results: ArtifactResolver,
  outputs: Map<string, Output>,
  prose: ProseParser,
  opts?: EvidenceRenderOptions,
): any[] {
  const nodes: any[] = [];
  const artifactId = evidence.artifact!;
  const output = outputs.get(artifactId);

  if (!output) {
    // Broken reference — the evidence points at an artifact id
    // that's not declared in `analysis.outputs`. Surface it instead
    // of silently dropping; downstream tooling can lint for these.
    reportWarn(
      opts?.vfile,
      `Evidence references unknown output id "${artifactId}" — broken reference dropped from output.`,
    );
    return nodes;
  }

  const resultPath = results(artifactId);
  if (!resultPath) {
    // Output is declared but the artifact file hasn't been produced
    // yet. Render a "Pending Output" admonition so the page makes
    // the absence visible.
    nodes.push(pendingOutput(artifactId));
    return nodes;
  }

  // Output declared and produced — dispatch on Output.type. label /
  // description on the Output carry the caption-equivalent metadata
  // that previously lived on Evidence.figure / Evidence.table; the
  // selector types are gone.
  switch (output.type) {
    case 'figure':
      nodes.push(
        ...figureBlock(output, artifactId, artifactUrl(artifactId, resultPath, opts?.resultUrl), prose),
      );
      break;
    case 'table':
      nodes.push(...renderTableArtifact(output, artifactId, resultPath, opts?.vfile));
      break;
    case 'metric':
    case 'data':
    case 'report':
      nodes.push(...renderInlineArtifact(output, artifactId, resultPath, evidence, opts?.vfile));
      break;
  }

  return nodes;
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
export function tableNodeFromData(data: TableData): any {
  const isNestedObject = data.headers[0] === '';
  const displayHeaders = isNestedObject ? ['', ...data.headers.slice(1)] : data.headers;
  const headerRow = tableRow(
    displayHeaders.map((c) => tableCell([text(c)], true)),
    true,
  );
  const rows = data.rows.map((row) =>
    tableRow(
      row.map((cell, i) =>
        isNestedObject && i === 0 ? tableCell([strong([text(cell)])]) : tableCell([text(cell)]),
      ),
    ),
  );
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
  insight: { evidence?: Evidence[] },
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
