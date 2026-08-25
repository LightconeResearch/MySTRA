/**
 * Load an ASTRA project and resolve output artifacts.
 *
 * Most of the work is the SDK's: `loadYaml` parses, `resolveAnalysisTree`
 * inlines `path:` sub-analyses into one tree (preserving each sub's `path:`).
 * What stays here is MySTRA-specific: locating the project's universe file
 * and result files on disk.
 */

import { dirname, join, parse as parsePath } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import {
  collectRecommendations,
  loadYaml,
  resolveAnalysisTree,
  validateAnalysis,
} from '@astra-spec/sdk';
import type { Analysis, Universe } from '@astra-spec/sdk';
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

/** What {@link resolveArtifact} needs beyond the path, to choose well and say so. */
export interface ArtifactHints {
  /**
   * The output's declared `format` — an extension token without the dot
   * (`csv`, `png`, `tar.gz`), inherited from the source for a `from:` alias.
   */
  format?: string;
  /** Routes the ambiguity warning to the page that triggered the resolve. */
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
 * Locate an output's artifact file — deterministically, on demand.
 *
 * astra-spec leaves the on-disk path to the runner; lightcone-cli fixes the
 * output *directory* as `[<analysis path>/]results/<universe>/<id>/`, so it is
 * computed (never scanned). The recipe chooses the file *name*, and may write
 * several files into that one directory, so the choice runs in order of
 * decreasing explicitness — mirroring the SDK's `discoverArtifact`, so a MySTRA
 * page and a viewer bind the same file:
 *
 *   1. `<id>.<format>`, when the output declares a `format:`
 *   2. any file carrying the declared extension (covers a name the recipe
 *      chose for itself, and dotted formats like `tar.gz`)
 *   3. `<id>.<anything>`, the convention this code has always preferred
 *   4. the first file, alphabetically — a last resort
 *
 * Whenever the file that won was picked by sort order rather than by its name,
 * the author hears about it: `format:` exists precisely so this directory never
 * needs a guess, and a guess that goes unmentioned is a page of numbers read
 * from the wrong artifact.
 *
 * Dotfiles (incl. `.lightcone-manifest.json`) are skipped throughout; an
 * absent directory means "not produced".
 */
export function resolveArtifact(
  base: string,
  universeId: string,
  outputId: string,
  hints: ArtifactHints = {},
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

  const suffix = hints.format ? `.${hints.format.toLowerCase()}` : undefined;
  const canonical = suffix
    ? files.find((f) => f.toLowerCase() === `${outputId.toLowerCase()}${suffix}`)
    : undefined;
  const suffixed = suffix ? files.filter((f) => f.toLowerCase().endsWith(suffix)) : [];
  const exact = files.find((f) => parsePath(f).name === outputId);
  const chosen = canonical ?? suffixed[0] ?? exact ?? files[0];

  // The selection is *identified* — by a name, not by sort order — when the
  // canonical `<id>.<format>` is present, or (with no format declared) the
  // `<id>.*` convention picked the file. A lone file carrying the declared
  // extension identifies it too, unless a *different* file matches the output
  // id, which means the declared format and the on-disk names disagree.
  const identified = suffix
    ? canonical !== undefined || (suffixed.length === 1 && (exact === undefined || exact === chosen))
    : exact !== undefined;
  if (files.length > 1 && !identified && !hints.warned?.has(outputId)) {
    hints.warned?.add(outputId);
    reportWarn(hints.vfile, ambiguityMessage(outputId, files, suffixed, exact, chosen, hints.format));
  }
  return join(dir, chosen);
}

/**
 * Say which file was read and why it was a guess. Four ways to end up here,
 * each pointing at a different edit, so each gets its own sentence.
 */
function ambiguityMessage(
  outputId: string,
  files: string[],
  suffixed: string[],
  exact: string | undefined,
  chosen: string,
  format?: string,
): string {
  const nudge = `Name the primary artifact "${outputId}.${format ?? '<ext>'}" to make the choice explicit.`;
  if (!format) {
    return `"${outputId}" has ${files.length} result files and none is named ` +
      `"${outputId}.*" — reading "${chosen}" by alphabetical order. Declare the ` +
      `output's \`format:\`, or name the primary artifact "${outputId}.<ext>".`;
  }
  if (suffixed.length === 0) {
    return `"${outputId}" declares \`format: ${format}\`, but none of its ` +
      `${files.length} result files carries that extension — reading "${chosen}". ` +
      `Fix the declared format, or write the artifact as "${outputId}.${format}".`;
  }
  if (suffixed.length > 1) {
    return `"${outputId}" declares \`format: ${format}\` and ${suffixed.length} of its ` +
      `${files.length} result files carry that extension — reading "${chosen}" by ` +
      `alphabetical order. ${nudge}`;
  }
  // One file has the declared extension, but another one owns the output's name.
  return `"${outputId}" declares \`format: ${format}\`, so it reads "${chosen}" — ` +
    `not "${exact}", which matches the output id. Fix whichever is wrong: the ` +
    `declared format, or the file names.`;
}

function safeIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
