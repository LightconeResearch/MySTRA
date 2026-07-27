/**
 * Load an ASTRA project and resolve output artifacts.
 *
 * Most of the work is the SDK's: `loadYaml` parses, `resolveAnalysisTree`
 * inlines `path:` sub-analyses into one tree (preserving each sub's `path:`).
 * What stays here is MySTRA-specific: locating the project's universe file
 * and result files on disk.
 */

import {
  dirname,
  extname,
  join,
  parse as parsePath,
  resolve,
} from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { loadYaml, resolveAnalysisTree, validateAnalysis } from '@astra-spec/sdk';
import type { Analysis, Universe } from '@astra-spec/sdk';
import { reportWarn } from './diagnostics.js';

/** The raw, unresolved astra.yaml dict as parsed by `loadYaml`. */
type RawSpec = Record<string, unknown>;

/** A loaded ASTRA project for one universe; `resolveScope` walks it from here. */
export interface ASTRASource {
  analysis: Analysis;
  universe: Universe;
  /** Every YAML file that contributed to the resolved project. */
  dependencyPaths: string[];
}

/** Resolve an output id to its artifact's absolute path, or `undefined`. */
export type ArtifactResolver = (outputId: string) => string | undefined;

/**
 * Load an ASTRA project. `vfile` routes validation diagnostics to MyST's
 * per-file channel (attributed to whichever page triggered the load — the
 * warnings are project-level, but the load happens once per spec edit).
 */
export function loadASTRASource(projectDir: string, vfile?: any): ASTRASource {
  const astraPath = join(projectDir, 'astra.yaml');
  if (!existsSync(astraPath)) throw new Error(`No astra.yaml found in ${projectDir}`);
  // Parse once: the same raw dict feeds both validation and tree resolution.
  const raw = loadYaml(astraPath);
  reportValidation(projectDir, raw, vfile);
  const analysis = resolveAnalysisTree(raw, projectDir) as unknown as Analysis;
  const universePath = universeFilePath(projectDir);
  return {
    analysis,
    universe: loadUniverse(projectDir),
    dependencyPaths: [
      ...analysisDependencyPaths(projectDir, analysis),
      ...(universePath ? [universePath] : []),
    ],
  };
}

/**
 * Run the SDK's spec validators over the raw astra.yaml and surface anything
 * they flag through the `[mystra]` warning channel — never by throwing.
 *
 * Policy: validation here is purely *advisory*. A malformed spec (a dangling
 * `from:`, an unknown decision in a `when:`) should be reported loudly, but
 * rendering must still proceed on whatever the resolver can make of the tree — a
 * missing field is far better diagnosed by a clear warning than by an opaque
 * late crash. So `SemanticError`s are emitted as warnings, and *no* validator
 * outcome aborts the load.
 *
 * @astra-spec/sdk is still v0.0.x, so the validators themselves are not yet
 * load-bearing: a validator that throws on some shape it didn't anticipate must
 * not take rendering down with it. Each call is therefore wrapped in try/catch
 * and a throwing validator is itself downgraded to a single warning.
 */
function reportValidation(projectDir: string, raw: RawSpec, vfile?: any): void {
  try {
    for (const item of validateAnalysis(raw, { basePath: projectDir })) {
      reportWarn(vfile, `validateAnalysis: ${item.toString()}`);
    }
  } catch (err) {
    // The validator itself blew up — downgrade to a warning and move on.
    const message = err instanceof Error ? err.message : String(err);
    reportWarn(vfile, `validateAnalysis could not run (skipped): ${message}`);
  }
}

/**
 * The files a parse depends on. Once a source has been loaded this includes
 * every nested `analyses.*.path` ASTRA file, not just the root and universe.
 */
export function sourceDependencyPaths(
  projectDir: string,
  source?: ASTRASource,
): string[] {
  if (source) {
    // Re-scan the universe directory so adding a first universe file (or a
    // lexicographically earlier replacement) invalidates a source that
    // previously depended only on the synthetic default universe.
    const universe = universeFilePath(projectDir);
    return [
      ...new Set([
        ...source.dependencyPaths,
        ...(universe ? [universe] : []),
      ]),
    ];
  }
  const paths = [join(projectDir, 'astra.yaml')];
  const universe = universeFilePath(projectDir);
  if (universe) paths.push(universe);
  return paths;
}

/** Directory that owns a child analysis and its result artifacts. */
export function childAnalysisDirectory(
  parentDir: string,
  child: Analysis,
): string {
  if (!child.path) return parentDir;
  const location = resolve(parentDir, child.path.replace(/^\.\//, ''));
  return /\.ya?ml$/i.test(extname(location)) ? dirname(location) : location;
}

/**
 * Collect the ASTRA YAML files followed by `resolveAnalysisTree`.
 *
 * The resolved SDK tree preserves each external child's authored `path`, so
 * walking that tree lets the cache watch the exact same nested files without
 * maintaining a second YAML parser.
 */
function analysisDependencyPaths(
  projectDir: string,
  analysis: Analysis,
): string[] {
  const paths = [join(projectDir, 'astra.yaml')];

  const visit = (node: Analysis, directory: string): void => {
    for (const child of Object.values(node.analyses ?? {})) {
      const childDirectory = childAnalysisDirectory(directory, child);
      if (child.path) paths.push(join(childDirectory, 'astra.yaml'));
      visit(child, childDirectory);
    }
  };

  visit(analysis, projectDir);
  return [...new Set(paths)];
}

/**
 * Resolve the project universe file's absolute path: the first `.ya?ml` file in
 * `universes/` (sorted), or `undefined` when the directory has none (a
 * synthetic empty universe is used). Shared by `loadUniverse` and
 * `sourceDependencyPaths` so both agree on which file backs the universe.
 */
function universeFilePath(projectDir: string): string | undefined {
  const dir = join(projectDir, 'universes');
  if (!existsSync(dir)) return undefined;
  const file = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()[0];
  return file ? join(dir, file) : undefined;
}

/**
 * Load the project universe from `universes/` (the first file, sorted; the
 * file stem is the universe id, per the lightcone convention), or a synthetic
 * empty universe when there are none.
 */
function loadUniverse(projectDir: string): Universe {
  const path = universeFilePath(projectDir);
  if (!path) return { id: 'default', decisions: {} };
  return loadYaml(path) as unknown as Universe;
}

/**
 * Locate an output's artifact file — deterministically, on demand.
 *
 * astra-spec leaves the on-disk path to the runner; lightcone-cli fixes the
 * output *directory* as `[<analysis path>/]results/<universe>/<id>/`, so it is
 * computed (never scanned). The recipe chooses the file *name*, so we read that
 * one directory, preferring `<id>.<ext>`, else the first regular file (dotfiles,
 * incl. `.lightcone-manifest.json`, skipped). Absent directory → not produced.
 */
export function resolveArtifact(
  base: string,
  universeId: string,
  outputId: string,
): string | undefined {
  const dir = join(base, 'results', universeId, outputId);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return undefined;
  }
  const files = entries
    .filter((f) => !f.startsWith('.') && safeIsFile(join(dir, f)))
    .sort();
  if (files.length === 0) return undefined;
  return join(dir, files.find((f) => parsePath(f).name === outputId) ?? files[0]);
}

function safeIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
