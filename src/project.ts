/**
 * Resolve an ASTRA project through the SDK and retain the result while every
 * filesystem value used to build it is unchanged.
 *
 * The SDK intentionally owns project discovery and resolution. This module is
 * only the MySTRA host boundary: it supplies the Node reader, derives the
 * lookup maps used while rendering, and prevents concurrent page transforms
 * from resolving the same project more than once.
 */

import { resolve as resolvePath } from 'node:path';

import {
  AnalysisValidationError,
  ProjectLoadError,
  indexAnalysis,
  resolveAnalysis,
  type AnalysisIndex,
  type ArtifactBinding,
  type ProjectDirectoryEntry,
  type ProjectEntry,
  type ProjectReader,
  type ResolvedAnalysisBundle,
  type ResolveAnalysisOptions,
  type ValidationIssue,
} from '@astra-spec/sdk';
import { createNodeProjectReader } from '@astra-spec/sdk/node';

export interface ResolvedProject {
  /** Absolute, normalized project root used by the SDK reader. */
  root: string;
  /** The SDK's canonical, serializable resolved analysis and artifact bindings. */
  bundle: ResolvedAnalysisBundle;
  /** Canonical analysis/record lookup maps derived from `bundle.document`. */
  index: AnalysisIndex;
  /** Materialized artifacts keyed by their canonical output record path. */
  bindingsByOutputPath: ReadonlyMap<string, ArtifactBinding>;
}

type DependencySnapshot =
  | { operation: 'stat'; path: string; value: ProjectEntry | undefined }
  | { operation: 'readText'; path: string; value: string }
  | { operation: 'readDirectory'; path: string; value: ProjectDirectoryEntry[] };

interface CachedProject {
  project: ResolvedProject;
  dependencies: readonly DependencySnapshot[];
}

interface CacheSlot {
  cached?: CachedProject;
  inFlight?: Promise<ResolvedProject>;
}

const projectCache = new Map<string, CacheSlot>();

function cloneEntry(entry: ProjectEntry | undefined): ProjectEntry | undefined {
  if (!entry) return undefined;
  return entry.type === 'directory'
    ? { type: 'directory' }
    : {
        type: 'file',
        size: entry.size,
        modifiedAtMs: entry.modifiedAtMs,
      };
}

function orderedDirectory(entries: readonly ProjectDirectoryEntry[]): ProjectDirectoryEntry[] {
  return entries
    .map(({ name, type }) => ({ name, type }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.type.localeCompare(right.type));
}

function dependencyKey(operation: DependencySnapshot['operation'], path: string): string {
  return `${operation}\0${path}`;
}

/**
 * Decorate a reader with dependency capture. Text is retained exactly,
 * directory order is normalized (the reader contract says it is insignificant),
 * and missing `stat()` results are dependencies too so a newly produced
 * artifact invalidates the cache.
 */
function trackingReader(delegate: ProjectReader): {
  reader: ProjectReader;
  snapshots: () => DependencySnapshot[];
} {
  const dependencies = new Map<string, DependencySnapshot>();
  const remember = (dependency: DependencySnapshot): void => {
    dependencies.set(dependencyKey(dependency.operation, dependency.path), dependency);
  };

  const reader: ProjectReader = {
    async readText(path: string): Promise<string> {
      const value = await delegate.readText(path);
      remember({ operation: 'readText', path, value });
      return value;
    },

    async stat(path: string): Promise<ProjectEntry | undefined> {
      const value = cloneEntry(await delegate.stat(path));
      remember({ operation: 'stat', path, value });
      return cloneEntry(value);
    },

    async readDirectory(path: string): Promise<ProjectDirectoryEntry[]> {
      const value = orderedDirectory(await delegate.readDirectory(path));
      remember({ operation: 'readDirectory', path, value });
      return value.map((entry) => ({ ...entry }));
    },
  };

  return {
    reader,
    snapshots: () => [...dependencies.values()],
  };
}

function entriesEqual(
  left: ProjectEntry | undefined,
  right: ProjectEntry | undefined,
): boolean {
  if (!left || !right) return left === right;
  if (left.type !== right.type) return false;
  if (left.type === 'directory' || right.type === 'directory') return true;
  return left.size === right.size && left.modifiedAtMs === right.modifiedAtMs;
}

function directoriesEqual(
  left: readonly ProjectDirectoryEntry[],
  right: readonly ProjectDirectoryEntry[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (entry, index) => entry.name === right[index]?.name && entry.type === right[index]?.type,
  );
}

async function dependencyIsFresh(
  reader: ProjectReader,
  dependency: DependencySnapshot,
): Promise<boolean> {
  try {
    switch (dependency.operation) {
      case 'stat':
        return entriesEqual(await reader.stat(dependency.path), dependency.value);
      case 'readText':
        return (await reader.readText(dependency.path)) === dependency.value;
      case 'readDirectory':
        return directoriesEqual(
          orderedDirectory(await reader.readDirectory(dependency.path)),
          dependency.value,
        );
    }
  } catch {
    // Never serve stale data when a dependency cannot be checked. A fresh SDK
    // resolution below will turn a persistent backend failure into its proper
    // ProjectLoadError.
    return false;
  }
}

async function cacheIsFresh(
  reader: ProjectReader,
  dependencies: readonly DependencySnapshot[],
): Promise<boolean> {
  const results = await Promise.all(
    dependencies.map((dependency) => dependencyIsFresh(reader, dependency)),
  );
  return results.every(Boolean);
}

function optionsCacheKey(options: ResolveAnalysisOptions): string {
  return options.universeId === undefined ? '<implicit>' : `universe:${options.universeId}`;
}

async function resolveFreshProject(
  root: string,
  options: ResolveAnalysisOptions,
): Promise<CachedProject> {
  const tracked = trackingReader(createNodeProjectReader(root));
  const bundle = await resolveAnalysis(tracked.reader, options);
  const project: ResolvedProject = {
    root,
    bundle,
    index: indexAnalysis(bundle.document),
    bindingsByOutputPath: new Map(
      bundle.bindings.map((binding) => [binding.outputPath, binding] as const),
    ),
  };
  return { project, dependencies: tracked.snapshots() };
}

/**
 * Load one fully resolved project. Calls for the same root/universe share one
 * freshness check or resolution in flight. A completed result is reused only
 * while every `readText`, `readDirectory`, and `stat` result consulted by the
 * SDK still compares equal.
 */
export function loadResolvedProject(
  root: string,
  options: ResolveAnalysisOptions = {},
): Promise<ResolvedProject> {
  const normalizedRoot = resolvePath(root);
  // Do not let a caller mutating its options object after this call change
  // which universe a task resolves under relative to its cache key.
  const resolveOptions: ResolveAnalysisOptions = options.universeId === undefined
    ? {}
    : { universeId: options.universeId };
  const key = JSON.stringify([normalizedRoot, optionsCacheKey(resolveOptions)]);
  let slot = projectCache.get(key);
  if (!slot) {
    slot = {};
    projectCache.set(key, slot);
  }
  if (slot.inFlight) return slot.inFlight;

  const task = (async (): Promise<ResolvedProject> => {
    const reader = createNodeProjectReader(normalizedRoot);
    if (slot.cached && await cacheIsFresh(reader, slot.cached.dependencies)) {
      return slot.cached.project;
    }

    const fresh = await resolveFreshProject(normalizedRoot, resolveOptions);
    slot.cached = fresh;
    return fresh.project;
  })();

  const inFlight = task.finally(() => {
    if (slot.inFlight === inFlight) slot.inFlight = undefined;
  });
  slot.inFlight = inFlight;
  return inFlight;
}

/** Clear all resolved projects, primarily for tests and explicit host resets. */
export function clearResolvedProjectCache(): void {
  projectCache.clear();
}

function issueLine(issue: ValidationIssue): string {
  const location = issue.path ? `${issue.file}:${issue.path}` : issue.file;
  return `${location} [${issue.code}] ${issue.message}`;
}

/** Turn SDK and unexpected failures into user-facing diagnostic lines. */
export function formatProjectError(error: unknown): string[] {
  if (error instanceof AnalysisValidationError) {
    return error.issues.length > 0
      ? error.issues.map(issueLine)
      : [error.message];
  }
  if (error instanceof ProjectLoadError) {
    const location = error.path ? `${error.path}: ` : '';
    return [`[${error.code}] ${location}${error.message}`];
  }
  if (error instanceof Error) return [error.message];
  return [String(error)];
}
