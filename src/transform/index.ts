/**
 * Main ASTRA → MyST AST transform.
 *
 * astraToMystAST() produces the full page AST for one analysis node.
 * buildAllPages() handles recursive sub-analysis page generation.
 */

import type { ASTRAAnalysis, ASTRAUniverse, ASTRAUniverseNode } from '../types/astra.js';
import type { PageData, PageFrontmatter, XRefEntry } from '../types/content-server.js';
import { join } from 'node:path';
import { sectionHeading, text, heading } from './ast-helpers.js';
import { renderAbstract } from './render-abstract.js';
import { renderUniverseBanner } from './render-universe-banner.js';
import { renderFindings } from './render-findings.js';
import { renderMethodsSections } from './render-methods.js';
import { renderInputsTable } from './render-data-sources.js';
import { renderSubAnalysisCards } from './render-sub-analyses.js';
import { setDOICacheDir } from './render-evidence.js';
import { toSlug } from '../utils/slug.js';

export interface ASTRASource {
  analysis: ASTRAAnalysis;
  universe: ASTRAUniverse;
  results: Map<string, string>;
  projectDir: string;
}

export function astraToMystAST(source: ASTRASource): { type: 'root'; children: any[] } {
  const { analysis, universe, results } = source;
  const decisions = analysis.decisions ?? {};
  const priorInsights = analysis.prior_insights ?? {};
  const findings = analysis.findings ?? {};
  const inputs = analysis.inputs ?? [];
  const outputs = analysis.outputs ?? [];

  const children: any[] = [
    // Title
    heading(1, [text(analysis.name ?? 'Analysis')], 'root'),

    // Abstract + success criteria
    ...renderAbstract(analysis),

    // Universe banner
    renderUniverseBanner(universe, decisions),

    // Findings section
    sectionHeading(2, 'Findings', 'findings'),
    ...renderFindings(findings, results, decisions, outputs),

    // Methods section
    sectionHeading(2, 'Methods', 'methods'),
    ...renderMethodsSections(decisions, priorInsights, universe),

    // Data Sources section
    sectionHeading(2, 'Data Sources', 'data-sources'),
    renderInputsTable(inputs),
  ];

  // Sub-Analyses section (only if present)
  if (analysis.analyses && Object.keys(analysis.analyses).length > 0) {
    children.push(
      sectionHeading(2, 'Sub-Analyses', 'sub-analyses'),
      ...renderSubAnalysisCards(analysis.analyses),
    );
  }

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
  const ast = astraToMystAST({ analysis, universe, results, projectDir });

  const frontmatter: PageFrontmatter = {
    title: analysis.name ?? slug,
    subtitle: 'ASTRA Analysis',
    authors: (analysis.authors ?? []).map((name) => ({ name })),
    tags: analysis.tags,
    description: analysis.description,
  };

  // Collect identifiers for cross-references
  const identifiers = collectIdentifiers(analysis, slug);

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

function collectIdentifiers(analysis: ASTRAAnalysis, slug: string): XRefEntry[] {
  const entries: XRefEntry[] = [];
  const dataPath = `/content/${slug}.json`;
  const url = slug === 'index' ? '/' : `/${slug}`;

  // Finding identifiers
  for (const findingId of Object.keys(analysis.findings ?? {})) {
    entries.push({
      identifier: `finding-${findingId}`,
      kind: 'heading',
      data: dataPath,
      url,
      implicit: true,
    });
  }

  // Section identifiers
  for (const section of ['findings', 'methods', 'data-sources', 'sub-analyses']) {
    entries.push({
      identifier: section,
      kind: 'heading',
      data: dataPath,
      url,
      implicit: true,
    });
  }

  // Decision group section identifiers
  const seenSections = new Set<string>();
  for (const decision of Object.values(analysis.decisions ?? {})) {
    if (decision.from || !decision.tags?.[0]) continue;
    const sectionId = toSlug(decision.tags[0]);
    if (!seenSections.has(sectionId)) {
      seenSections.add(sectionId);
      entries.push({
        identifier: sectionId,
        kind: 'heading',
        data: dataPath,
        url,
        implicit: true,
      });
    }
  }

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
