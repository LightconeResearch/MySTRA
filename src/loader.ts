/**
 * Load an ASTRA project for one universe, and resolve output artifacts.
 *
 * Most of the work is the SDK's: `loadYaml` parses, `resolveAnalysisTree`
 * inlines `path:` sub-analyses into one tree (preserving each sub's `path:`).
 * What stays here is MySTRA-specific: picking a universe and locating result
 * files on disk.
 */

import { dirname, join, parse as parsePath } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { loadYaml, resolveAnalysisTree } from '@astra-spec/sdk';
import type { Analysis, Universe } from '@astra-spec/sdk';

/** A loaded ASTRA project for one universe; `resolveScope` walks it from here. */
export interface ASTRASource {
  analysis: Analysis;
  universe: Universe;
  projectDir: string;
  /** Slug of the loaded node (`index` for the root analysis). */
  slug: string;
}

/** Resolve an output id to its artifact's absolute path, or `undefined`. */
export type ArtifactResolver = (outputId: string) => string | undefined;

export function loadASTRASource(projectDir: string, universeName?: string): ASTRASource {
  const astraPath = join(projectDir, 'astra.yaml');
  if (!existsSync(astraPath)) throw new Error(`No astra.yaml found in ${projectDir}`);
  const analysis = resolveAnalysisTree(loadYaml(astraPath), projectDir) as unknown as Analysis;
  return { analysis, universe: loadUniverse(projectDir, universeName), projectDir, slug: 'index' };
}

/**
 * Load one universe from `universes/<name>.yaml` (the file stem is the universe
 * id, per the lightcone convention), or the first file when no name is given,
 * or a synthetic empty universe when there are none.
 */
function loadUniverse(projectDir: string, name?: string): Universe {
  const dir = join(projectDir, 'universes');
  const file = name
    ? `${name}.yaml`
    : existsSync(dir)
      ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()[0]
      : undefined;
  if (!file || !existsSync(join(dir, file))) {
    if (name) throw new Error(`Universe "${name}" not found in ${dir}`);
    return { id: 'default', decisions: {} };
  }
  return loadYaml(join(dir, file)) as unknown as Universe;
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
