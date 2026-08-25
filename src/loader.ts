/**
 * Load an ASTRA project and locate output artifacts.
 *
 * Most of the work is the SDK's: `loadYaml` parses, `resolveAnalysisTree`
 * inlines `path:` sub-analyses into one tree (preserving each sub's `path:`).
 * What stays here is MySTRA-specific: finding the project's universe file, and
 * deriving where each output's single artifact file lives —
 * `<home>/results/<universe>/<inline scope…>/<id>.<format>`, the layout
 * lightcone-cli writes.
 */

import { join } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import {
  collectRecommendations,
  loadYaml,
  resolveAnalysisTree,
  validateAnalysis,
} from '@astra-spec/sdk';
import type { Analysis, Universe, UniverseNode } from '@astra-spec/sdk';
import { reportWarn } from './diagnostics.js';

/** The raw, unresolved astra.yaml dict as parsed by `loadYaml`. */
type RawSpec = Record<string, unknown>;

/** A loaded ASTRA project for one universe; `resolveScope` walks it from here. */
export interface ASTRASource {
  analysis: Analysis;
  universe: Universe;
}

/** Resolve an output id to its artifact's absolute path, or `undefined`. */
export type ArtifactResolver = (outputId: string) => string | undefined;

/**
 * Where one analysis node's outputs land — the three things that, with an
 * output's id and `format:`, *derive* its path. Mirrors lightcone-cli's
 * `_Placement` (`engine/plan.py`), which is what actually writes the tree.
 */
export interface Placement {
  /** The directory holding that node's own `astra.yaml`. */
  home: string;
  /** The universe its results are filed under. */
  universeId: string;
  /** The inline sub-analyses descended through since `home`. */
  scope: string[];
}

/** What {@link resolveArtifact} needs beyond the path, to choose well and say so. */
export interface ArtifactHints {
  /**
   * The output's declared `format` — an extension token without the dot
   * (`csv`, `png`, `tar.gz`), inherited from the source for a `from:` alias.
   * Without it the path cannot be derived and the directory must be searched.
   */
  format?: string;
  /** Routes the format-less-search warning to the page that triggered it. */
  vfile?: any;
  /**
   * Output ids already warned about. Owned by the caller (one set per vfile)
   * so the nudge is emitted once per page, not once per reference.
   */
  warned?: Set<string>;
}

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
  return { analysis, universe: loadUniverse(projectDir) };
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
  // Recommended-but-absent fields — chiefly `Output.format`, which is what
  // lets `resolveArtifact` bind a multi-file output without guessing. Advisory
  // in ASTRA 0.0.x, required from 0.1.0; a separate channel from the errors
  // above because a recommendation must never make an analysis invalid.
  try {
    for (const message of collectRecommendations(raw as any, { basePath: projectDir })) {
      reportWarn(vfile, `astra: ${message}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reportWarn(vfile, `collectRecommendations could not run (skipped): ${message}`);
  }
}

/**
 * The files a parse depends on — `astra.yaml` and the active universe file —
 * for the plugin's mtime-based cache freshness check. Owned by the loader so
 * the dependency set and the load itself cannot drift apart.
 */
export function sourceDependencyPaths(projectDir: string): string[] {
  const paths = [join(projectDir, 'astra.yaml')];
  const universe = universeFilePath(projectDir);
  if (universe) paths.push(universe);
  return paths;
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
 * Descend one sub-analysis, giving the placement its outputs land under.
 *
 * An external sub-analysis (`path:`) is a self-similar analysis with its own
 * home and, where the universe names one, its own universe — so both reset. An
 * inline one shares its parent's home and disambiguates with a scope
 * directory. Only the path nests; addressing stays the qualified id.
 */
export function descendPlacement(
  place: Placement,
  segId: string,
  child: Analysis,
  universeNode: UniverseNode | undefined,
): Placement {
  if (!child.path) return { ...place, scope: [...place.scope, segId] };
  return {
    home: join(place.home, child.path.replace(/^\.\//, '')),
    universeId: universeNode?.universe ?? place.universeId,
    scope: [],
  };
}

/**
 * Walk a chain of sub-analysis ids from `place`, returning where the node at
 * the end files its results — or `undefined` if a segment names no
 * sub-analysis. Used to follow a re-export's `from:` hops to the scope that
 * actually produces the bytes.
 */
export function descendTo(
  place: Placement,
  analysis: Analysis,
  universeNode: UniverseNode | undefined,
  segs: string[],
): Placement | undefined {
  let at = place;
  let node = analysis;
  let universe = universeNode;
  for (const seg of segs) {
    const child = node.analyses?.[seg];
    if (!child) return undefined;
    const childUniverse = universe?.analyses?.[seg];
    at = descendPlacement(at, seg, child, childUniverse);
    node = child;
    universe = childUniverse;
  }
  return at;
}

/** The directory an analysis node's results are filed in. */
function resultsDir(place: Placement): string {
  return join(place.home, 'results', place.universeId, ...place.scope);
}

/**
 * Locate an output's artifact — by *deriving* its path, not by searching.
 *
 * An output is one file. lightcone-cli names it from the spec —
 * `<home>/results/<universe>/<inline scope…>/<id>.<format>` (`engine/assets.py`:
 * "the format comes from the spec, so the path is derived rather than chosen by
 * the recipe, and one output can only ever be one file") — with the run
 * manifest as a `.<id>.manifest.json` sidecar beside it. So MySTRA computes the
 * same path and asks whether it is there. An absent file means "not produced".
 *
 * The one search left is transitional. `format:` is only *recommended* until
 * ASTRA 0.1.0, and without it there is no extension to derive, so an output
 * that declares none falls back to matching `<id>.<ext>` in its results
 * directory — and says so when that leaves a choice to make.
 */
export function resolveArtifact(
  place: Placement,
  outputId: string,
  hints: ArtifactHints = {},
): string | undefined {
  const dir = resultsDir(place);
  if (hints.format) {
    const path = join(dir, `${outputId}.${hints.format}`);
    return safeIsFile(path) ? path : undefined;
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return undefined;
  }
  // `<id>.` and not just the stem: for `fit`, this takes `fit.csv` and leaves
  // `fit_extra.csv`. Dotfiles are skipped, so the manifest sidecar — which is
  // literally `.<id>.manifest.json` — can never be mistaken for the artifact.
  const prefix = `${outputId}.`;
  const matches = entries
    .filter((f) => !f.startsWith('.') && f.startsWith(prefix) && safeIsFile(join(dir, f)))
    .sort();
  if (matches.length === 0) return undefined;
  if (matches.length > 1 && !hints.warned?.has(outputId)) {
    hints.warned?.add(outputId);
    reportWarn(
      hints.vfile,
      `"${outputId}" declares no \`format:\` and ${matches.length} files could be it ` +
        `(${matches.join(', ')}) — reading "${matches[0]}" by alphabetical order. ` +
        `Declare the output's \`format:\` to name the artifact.`,
    );
  }
  return join(dir, matches[0]);
}

function safeIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
