/**
 * Canonical project and scope resolution shared by page stores and inventory.
 *
 * Loading, universe narrowing, inheritance, artifact lookup, and provenance
 * context happen here once. Public payloads are projections of these scopes;
 * they do not independently walk ASTRA's analysis tree.
 */

import { realpathSync } from 'node:fs';
import { basename, relative, sep } from 'node:path';
import type {
  Analysis,
  Input,
  Insight,
  Output,
  Universe,
} from '@astra-spec/sdk';
import {
  childAnalysisDirectory,
  resolveArtifact,
  type ASTRASource,
  type ArtifactResolver,
} from './loader.js';
import {
  buildResolvedStore,
  type ResolvedStore,
} from './transform/resolved-store.js';
import { resolveOutputs } from './transform/resolve-output.js';
import {
  narrow,
  pageFrames,
  type ProvFrame,
} from './transform/provenance.js';

export interface ResolvedProjectScope {
  root: string;
  source: ASTRASource;
  /** Empty for the root, otherwise the canonical dot-separated scope path. */
  id: string;
  name: string;
  parent?: string;
  children: string[];
  path: string[];
  directory: string;
  analysis: Analysis;
  universe: Universe;
  ancestors: Analysis[];
  results: ArtifactResolver;
  priorInsights: Record<string, Insight>;
  priorInsightPaths: ReadonlyMap<string, string>;
  outputsById: Map<string, Output>;
  parentInputs: Map<string, Input>[];
  slug: string;
  frame: ProvFrame;
}

export interface ResolvedProject {
  root: string;
  source: ASTRASource;
  scopes: ResolvedProjectScope[];
  scopeById: ReadonlyMap<string, ResolvedProjectScope>;
}

function scopeId(path: string[]): string {
  return path.join('.');
}

function isOutputId(value: string): boolean {
  return Boolean(value)
    && value !== '.'
    && value !== '..'
    && basename(value) === value;
}

function activeChildUniverse(parent: Universe, childId: string): Universe {
  const child = narrow(parent, childId);
  return {
    id: parent.id,
    description: parent.description,
    decisions: child.decisions,
    analyses: child.analyses as Universe['analyses'],
  };
}

function inheritedInsights(
  ancestors: Analysis[],
  analysis: Analysis,
): Record<string, Insight> {
  return Object.assign(
    {},
    ...ancestors.map((ancestor) => ancestor.prior_insights ?? {}),
    analysis.prior_insights ?? {},
  );
}

/** Resolve one project into the ordered scope graph used by every serializer. */
export function buildResolvedProject(
  source: ASTRASource,
  root: string,
): ResolvedProject {
  const scopes: ResolvedProjectScope[] = [];

  const visit = (
    analysis: Analysis,
    universe: Universe,
    path: string[],
    directory: string,
    ancestors: Analysis[],
    inheritedInsightPaths: ReadonlyMap<string, string>,
  ): void => {
    const id = scopeId(path);
    const childEntries = Object.entries(analysis.analyses ?? {});
    const results: ArtifactResolver = (outputId) => {
      if (!isOutputId(outputId)) return undefined;
      return resolveArtifact(directory, source.universe.id, outputId);
    };
    const parentInputs = ancestors.map(
      (ancestor) =>
        new Map((ancestor.inputs ?? []).map((input) => [input.id, input])),
    );
    const priorInsightPaths = new Map(inheritedInsightPaths);
    for (const id of Object.keys(analysis.prior_insights ?? {})) {
      priorInsightPaths.set(id, [...path, 'prior_insights', id].join('.'));
    }

    scopes.push({
      root,
      source,
      id,
      name: analysis.name ?? analysis.id ?? path.at(-1) ?? 'Analysis',
      parent: path.length ? scopeId(path.slice(0, -1)) : undefined,
      children: childEntries.map(([childId]) => scopeId([...path, childId])),
      path,
      directory,
      analysis,
      universe,
      ancestors,
      results,
      priorInsights: inheritedInsights(ancestors, analysis),
      priorInsightPaths,
      outputsById: new Map(
        resolveOutputs(analysis).map(({ resolved }) => [resolved.id, resolved]),
      ),
      parentInputs,
      slug: path.length ? path.join('/') : 'index',
      frame: pageFrames([...ancestors, analysis], source.universe, path),
    });

    for (const [childId, child] of childEntries) {
      visit(
        child,
        activeChildUniverse(universe, childId),
        [...path, childId],
        childAnalysisDirectory(directory, child),
        [...ancestors, analysis],
        priorInsightPaths,
      );
    }
  };

  visit(source.analysis, source.universe, [], root, [], new Map());
  return {
    root,
    source,
    scopes,
    scopeById: new Map(scopes.map((scope) => [scope.id, scope])),
  };
}

/**
 * Turn a canonical scope into the common browser-facing record store.
 * Inventory aggregation and regular pages call this same serializer.
 */
export function buildScopeStore(scope: ResolvedProjectScope): ResolvedStore {
  return buildResolvedStore(
    scope.analysis,
    scope.universe,
    scope.results,
    scope.slug,
    (artifact) => projectArtifactUrl(scope.root, artifact),
    scope.parentInputs,
    scope.priorInsights,
    scope.frame,
    scope.priorInsightPaths,
  );
}

/** Resolve symlinks and expose only artifacts contained by the project root. */
export function projectArtifactUrl(
  projectRoot: string,
  absolutePath: string,
): string | undefined {
  try {
    const path = relative(
      realpathSync(projectRoot),
      realpathSync(absolutePath),
    );
    if (!path || path === '..' || path.startsWith(`..${sep}`)) return undefined;
    return path.split(sep).join('/');
  } catch {
    return undefined;
  }
}
