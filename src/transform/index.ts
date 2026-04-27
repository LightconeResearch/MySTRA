/**
 * Main ASTRA → MyST AST transform.
 *
 * astraToMystAST() produces the full page AST for one analysis node.
 * buildAllPages() handles recursive sub-analysis page generation.
 */

import type { ASTRAAnalysis, ASTRAUniverse, ASTRAUniverseNode } from '../types/astra.js';
import type { PageData, PageFrontmatter, XRefEntry } from '../types/content-server.js';
import { join } from 'node:path';
import { blockBreak } from './ast-helpers.js';
import { renderNarrativeChunks } from './render-narrative.js';
import { renderUniverseBanner } from './render-universe-banner.js';
import { renderFindings } from './render-findings.js';
import { renderMethodsSections, isDecisionRendered } from './render-methods.js';
import { renderInputsTable, renderOutputsTable } from './render-data-sources.js';
import { renderSubAnalysisCards } from './render-sub-analyses.js';
import { setDOICacheDir } from './render-evidence.js';
import { makeProseParser } from './narrative-parser.js';

export interface ASTRASource {
  analysis: ASTRAAnalysis;
  universe: ASTRAUniverse;
  results: Map<string, string>;
  projectDir: string;
  /** Slug of the host page; needed to build sub-analysis links from
   * narrative anchors (e.g. `#analyses.feature_extraction`). */
  slug: string;
}

export function astraToMystAST(source: ASTRASource): { type: 'root'; children: any[] } {
  const { analysis, universe, results, slug } = source;
  const decisions = analysis.decisions ?? {};
  const priorInsights = analysis.prior_insights ?? {};
  const findings = analysis.findings ?? {};
  const inputs = analysis.inputs ?? [];
  const outputs = analysis.outputs ?? [];

  // The prose parser is bound once to `(analysis, slug)` and threaded
  // into every render-* helper that touches Markdown. This makes the
  // narrative anchor grammar `[t](#path.to.element)` work in every
  // prose surface, not just narrative sections — anchors in
  // rationales, descriptions, claims, captions, and criterion claims
  // all resolve to crossReferences against the host analysis.
  const prose = makeProseParser({ analysis, slug });

  // Page layout: emit a flat sequence of named, addressable blocks
  // — narrative chunks AND structural elements at the same level.
  // No top-level section h2s, no narrative wrapper. mdast position
  // is the spec-declared default; downstream renderers (paper,
  // dashboard, DAG) compose layouts however they like by looking
  // up `identifier` attributes.
  const narrativeChunks = renderNarrativeChunks(analysis, slug);
  const children: any[] = [
    // Block break separating frontmatter from content
    blockBreak('{"class": ""}'),

    // Narrative chunks: each section is an addressable block
    // identified by `narrative-<section>`. Spec-declared order
    // (summary → findings → methods → inputs → outputs).
    ...narrativeChunks.flatMap((c) => c.mdast),

    // Universe banner — orientation for which decision selections
    // are active in this rendering. Includes universe.description
    // as prose so any anchor links inside it resolve too.
    renderUniverseBanner(universe, decisions, prose),

    // Structural elements as a flat sequence of addressable blocks.
    ...renderFindings(findings, results, decisions, outputs, prose),
    ...renderMethodsSections(decisions, priorInsights, universe, prose),
    ...(inputs.length > 0 ? [renderInputsTable(inputs, prose)] : []),
    ...(outputs.length > 0 ? [renderOutputsTable(outputs, prose)] : []),
    ...(analysis.analyses && Object.keys(analysis.analyses).length > 0
      ? renderSubAnalysisCards(analysis.analyses, slug)
      : []),
  ];

  return { type: 'root', children };
}

/**
 * Recursively build pages for an analysis and all sub-analyses.
 */
export function buildAllPages(
  analysis: ASTRAAnalysis,
  universe: ASTRAUniverse,
  results: Map<string, string>,
  projectDir: string,
  basePath = '',
  level = 1,
): PageData[] {
  const pages: PageData[] = [];
  const slug = basePath || 'index';

  // Set DOI cache dir so evidence rendering can look up citation metadata
  setDOICacheDir(join(projectDir, '.mystra-cache', 'doi'));

  // Build page for this analysis node
  const ast = astraToMystAST({ analysis, universe, results, projectDir, slug });

  // PageFrontmatter.description feeds OpenGraph/SEO/list previews. ASTRA
  // v0.0.6 dropped the free-form `description` slot in favour of a
  // structured narrative; the summary section is the closest analogue
  // (single-paragraph orientation for the analysis), so we surface its
  // first paragraph as plain text.
  const frontmatter: PageFrontmatter = {
    title: analysis.name ?? slug,
    subtitle: 'ASTRA Analysis',
    authors: (analysis.authors ?? []).map((name) => ({ name })),
    tags: analysis.tags,
    description: firstParagraph(analysis.narrative?.summary),
  };

  // Collect identifiers for cross-references
  const identifiers = collectIdentifiers(analysis, universe, slug);

  // Collect static file dependencies
  const dependencies = collectDependencies(results);

  // Collect DOIs
  const dois = collectDOIs(analysis);

  pages.push({
    slug,
    title: analysis.name ?? slug,
    level,
    ast,
    frontmatter,
    identifiers,
    dependencies,
    dois,
  });

  // Recurse into sub-analyses
  if (analysis.analyses) {
    for (const [id, sub] of Object.entries(analysis.analyses)) {
      const subPath = basePath ? `${basePath}/${id}` : id;

      // Get sub-universe selections
      const subUniverseNode: ASTRAUniverseNode | undefined = universe.analyses?.[id];
      const subUniverse: ASTRAUniverse = {
        id: universe.id,
        description: universe.description,
        decisions: subUniverseNode?.decisions ?? {},
        analyses: subUniverseNode?.analyses,
      };

      // Sub-analysis results would be in a nested path
      // For now, pass the same results map (scanner handles universe-scoped paths)
      pages.push(
        ...buildAllPages(sub, subUniverse, results, projectDir, subPath, level + 1),
      );
    }
  }

  return pages;
}

function collectIdentifiers(
  analysis: ASTRAAnalysis,
  universe: ASTRAUniverse,
  slug: string,
): XRefEntry[] {
  const entries: XRefEntry[] = [];
  const dataPath = `/content/${slug}.json`;
  const url = slug === 'index' ? '/' : `/${slug}`;

  const push = (identifier: string) =>
    entries.push({ identifier, kind: 'heading', data: dataPath, url, implicit: true });

  // Narrative-chunk identifiers: each non-empty section is an
  // addressable block at `narrative-<section>`.
  for (const section of ['summary', 'findings', 'methods', 'inputs', 'outputs'] as const) {
    if (analysis.narrative?.[section]) push(`narrative-${section}`);
  }

  // Per-element identifiers (`<kind>-<id>`) for every structural
  // element. Page-level section identifiers (findings, methods, …)
  // are no longer published — those h2 wrappers no longer exist.
  // The xref contract: only publish ids with a real carrier in the
  // emitted AST. Decisions that aren't rendered (bare `from`-refs
  // and `when`-unmet ones) are filtered with the same predicate
  // renderMethodsSections uses.
  for (const id of Object.keys(analysis.findings ?? {})) push(`finding-${id}`);
  for (const id of Object.keys(analysis.prior_insights ?? {})) push(`prior_insight-${id}`);
  for (const [id, decision] of Object.entries(analysis.decisions ?? {})) {
    if (isDecisionRendered(decision, universe)) push(`decision-${id}`);
  }
  for (const input of analysis.inputs ?? []) push(`input-${input.id}`);
  for (const output of analysis.outputs ?? []) push(`output-${output.id}`);
  for (const id of Object.keys(analysis.analyses ?? {})) push(`analysis-${id}`);

  return entries;
}

function collectDependencies(results: Map<string, string>): string[] {
  const deps: string[] = [];
  for (const [outputId, filePath] of results) {
    const ext = filePath.split('.').pop();
    if (ext && ['png', 'jpg', 'jpeg', 'svg'].includes(ext)) {
      deps.push(`/static/${outputId}.${ext}`);
    }
  }
  return deps;
}

/**
 * Plain-text first paragraph of a markdown string, with simple inline
 * markdown stripped — suitable for OpenGraph/SEO descriptions.
 */
function firstParagraph(md: string | undefined): string | undefined {
  if (!md) return undefined;
  const first = md.split(/\n{2,}/, 1)[0]?.trim();
  if (!first) return undefined;
  return first
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ');
}

function collectDOIs(analysis: ASTRAAnalysis): string[] {
  const dois = new Set<string>();

  for (const insight of Object.values(analysis.prior_insights ?? {})) {
    for (const ev of insight.evidence) {
      if (ev.doi) dois.add(ev.doi);
    }
  }

  for (const finding of Object.values(analysis.findings ?? {})) {
    for (const ev of finding.evidence) {
      if (ev.doi) dois.add(ev.doi);
    }
  }

  return Array.from(dois);
}
