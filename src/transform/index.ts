/**
 * Main ASTRA → MyST AST transform.
 *
 * astraToMystAST() produces the full page AST for one analysis node.
 * buildAllPages() handles recursive sub-analysis page generation.
 */

import type {
  Analysis as ASTRAAnalysis,
  Insight as ASTRAInsight,
  Universe as ASTRAUniverse,
  UniverseNode as ASTRAUniverseNode,
} from '@astra-spec/sdk';
import type { PageData, PageFrontmatter, XRefEntry } from '../types/content-server.js';
import { join } from 'node:path';
import { blockBreak, makeTabItem } from './ast-helpers.js';
import { renderNarrativeChunks } from './render-narrative.js';
import { renderUniverseBanner } from './render-universe-banner.js';
import { renderFindings } from './render-findings.js';
import { renderPriorInsights } from './render-prior-insights.js';
import { renderMethodsSections, isDecisionRendered } from './render-methods.js';
import { renderInputsTable, renderOutputsTable } from './render-data-sources.js';
import { renderOutputProvenance } from './render-output-provenance.js';
import { renderOutputRecipes, hasRecipe } from './render-output-recipe.js';
import { resolveOutputs } from './resolve-output.js';
import { renderSubAnalysisCards } from './render-sub-analyses.js';
import { makeProseParser, firstParagraphText } from './narrative-parser.js';
import type { AnalysisScope, PriorInsightScope } from './narrative-parser.js';

export interface ASTRASource {
  analysis: ASTRAAnalysis;
  universe: ASTRAUniverse;
  results: Map<string, string>;
  projectDir: string;
  /** Slug of the host page; needed to build sub-analysis links from
   * narrative anchors (e.g. `#analyses.feature_extraction`). */
  slug: string;
  /** Ancestor prior_insights keyed by the page slug that owns their
   * rendered `prior_insight-<id>` carrier. */
  priorInsightScopes?: PriorInsightScope[];
  /** Ancestor analyses keyed by page slug for cross-scope output
   * image embeds such as `#../outputs.<id>`. */
  analysisScopes?: AnalysisScope[];
}

export function astraToMystAST(source: ASTRASource): { type: 'root'; children: any[] } {
  const { analysis, universe, results, projectDir, slug } = source;
  const decisions = analysis.decisions ?? {};
  const priorInsights = analysis.prior_insights ?? {};
  const priorInsightLookup = mergePriorInsights(source.priorInsightScopes ?? [], priorInsights);
  const findings = analysis.findings ?? {};
  const inputs = analysis.inputs ?? [];
  const outputs = analysis.outputs ?? [];

  // The prose parser is bound once to `(analysis, slug)` and threaded
  // into every render-* helper that touches Markdown. This makes the
  // narrative anchor grammar `[t](#path.to.element)` work in every
  // prose surface, not just narrative sections — anchors in
  // rationales, descriptions, claims, captions, and criterion claims
  // all resolve to crossReferences against the host analysis.
  const proseContext = {
    analysis,
    slug,
    priorInsightScopes: source.priorInsightScopes,
    analysisScopes: source.analysisScopes,
    results,
  };
  const prose = makeProseParser(proseContext);

  // Per-pass tabItem factory — each transform invocation gets its
  // own counter so two consecutive transforms produce identical
  // `key`s for downstream AST diffing.
  const tabItem = makeTabItem();

  // DOI cache dir threaded through every renderer that emits a cite
  // node. Originates from `projectDir`; absent when no project dir
  // is available (the cite node falls back to a plain DOI link).
  const doiCacheDir = projectDir ? join(projectDir, '.mystra-cache', 'doi') : null;

  // Outputs as an id→Output map so artifact-evidence rendering can
  // dispatch on `output.type` (figure/table/metric/data/report) in
  // O(1). Builds once per page; broken evidence references emit a
  // console.warn at render time when the id isn't in this map.
  const outputsById = new Map(outputs.map((o) => [o.id, o] as const));

  // Page layout: emit a flat sequence of named, addressable blocks
  // — narrative chunks AND structural elements at the same level.
  // No top-level section h2s, no narrative wrapper. mdast position
  // is the spec-declared default; downstream renderers (paper,
  // dashboard, DAG) compose layouts however they like by looking
  // up `identifier` attributes.
  const narrativeChunks = renderNarrativeChunks(analysis, slug, proseContext);
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
    ...renderFindings(findings, results, outputsById, prose, doiCacheDir),
    ...renderPriorInsights(priorInsights, prose, doiCacheDir),
    ...renderMethodsSections(decisions, priorInsightLookup, universe, prose, tabItem, doiCacheDir),
    ...(inputs.length > 0 ? [renderInputsTable(inputs, prose)] : []),
    ...(outputs.length > 0 ? [renderOutputsTable(outputs, prose)] : []),
    // Per-Output provenance blocks (Output.inputs / Output.decisions
    // from astra-spec v0.0.7 PR #19). Sits adjacent to the outputs
    // registry table; one container per Output with non-empty
    // provenance, addressable as `output-<id>-provenance`. The
    // resolved view is what renderers see — `from:` chains are
    // walked here so consumers (lightcone-ui, vellum, …) never read
    // `astra.yaml` directly to recover provenance.
    ...renderOutputProvenance(analysis),
    // Per-Output recipe carriers (the *how*: command, container,
    // resources). One `kind: 'output-recipe'` container per Output
    // with a non-empty resolved recipe. Display direction is
    // renderer-side: structured `data` slot lets consumers
    // pattern-match; fallback children are a `details` block
    // collapsed by default. Closes the Recipe coverage hole — no
    // consumer needs to read `astra.yaml` to recover the recipe.
    ...renderOutputRecipes(analysis),
    ...(analysis.analyses && Object.keys(analysis.analyses).length > 0
      ? renderSubAnalysisCards(analysis.analyses, slug, {
          priorInsightScopes: nextPriorInsightScopes(
            source.priorInsightScopes ?? [],
            slug,
            priorInsights,
          ),
          analysisScopes: nextAnalysisScopes(source.analysisScopes ?? [], slug, analysis),
          results,
        })
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
  priorInsightScopes: PriorInsightScope[] = [],
  analysisScopes: AnalysisScope[] = [],
): PageData[] {
  const pages: PageData[] = [];
  const slug = basePath || 'index';

  // Build page for this analysis node. astraToMystAST derives the
  // DOI cache dir from `projectDir` and threads it into every
  // renderer that emits a cite node — no module-global state.
  const ast = astraToMystAST({
    analysis,
    universe,
    results,
    projectDir,
    slug,
    priorInsightScopes,
    analysisScopes,
  });

  // PageFrontmatter.description feeds OpenGraph/SEO/list previews. ASTRA
  // v0.0.6 dropped the free-form `description` slot in favour of a
  // structured narrative; the summary section is the closest analogue
  // (single-paragraph orientation for the analysis), so we surface its
  // first paragraph as plain text. No renderer-imposed `subtitle` —
  // astra-spec defines no analysis-level subtitle field; pinning one
  // here would assert content type in metadata.
  const frontmatter: PageFrontmatter = {
    title: analysis.name ?? slug,
    authors: (analysis.authors ?? []).map((name) => ({ name })),
    tags: analysis.tags,
    description: firstParagraphText(analysis.narrative?.summary),
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
    const childPriorInsightScopes = nextPriorInsightScopes(
      priorInsightScopes,
      slug,
      analysis.prior_insights ?? {},
    );
    const childAnalysisScopes = nextAnalysisScopes(analysisScopes, slug, analysis);
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
        ...buildAllPages(
          sub,
          subUniverse,
          results,
          projectDir,
          subPath,
          level + 1,
          childPriorInsightScopes,
          childAnalysisScopes,
        ),
      );
    }
  }

  return pages;
}

function mergePriorInsights(
  scopes: PriorInsightScope[],
  local: Record<string, ASTRAInsight>,
): Record<string, ASTRAInsight> {
  return Object.assign({}, ...scopes.map((scope) => scope.priorInsights), local);
}

function nextPriorInsightScopes(
  scopes: PriorInsightScope[],
  slug: string,
  local: Record<string, ASTRAInsight>,
): PriorInsightScope[] {
  return Object.keys(local).length > 0
    ? [...scopes, { slug, priorInsights: local }]
    : scopes;
}

function nextAnalysisScopes(
  scopes: AnalysisScope[],
  slug: string,
  analysis: ASTRAAnalysis,
): AnalysisScope[] {
  return [...scopes, { slug, analysis }];
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
  // Per-Output provenance + recipe carriers. Same predicate as
  // their respective render modules (resolved view has the relevant
  // content) so the xref contract — only publish ids with a real
  // carrier — holds even for aliased outputs whose provenance/recipe
  // arrives via `from:`.
  for (const r of resolveOutputs(analysis)) {
    const inputs = r.resolved.inputs ?? [];
    const decisions = r.resolved.decisions ?? [];
    if (inputs.length > 0 || decisions.length > 0) {
      push(`output-${r.declared.id}-provenance`);
    }
    if (hasRecipe(r)) {
      push(`output-${r.declared.id}-recipe`);
    }
  }
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
