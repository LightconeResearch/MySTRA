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
import {
  loadYaml,
  resolveAnalysisTree,
  validateAnalysis,
  validateNarrativeAnchors,
  checkNarrativeCoverage,
  validateNarrativeSections,
  validateAnalysisData,
} from '@astra-spec/sdk';
import type { Analysis, Universe } from '@astra-spec/sdk';

/** The raw, unresolved astra.yaml dict as parsed by `loadYaml`. */
type RawSpec = Record<string, unknown>;

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
  // Parse once: the same raw dict feeds both validation and tree resolution.
  const raw = loadYaml(astraPath);
  reportValidation(projectDir, raw);
  const analysis = resolveAnalysisTree(raw, projectDir) as unknown as Analysis;
  return { analysis, universe: loadUniverse(projectDir, universeName), projectDir, slug: 'index' };
}

/**
 * Run the SDK's spec validators over the raw astra.yaml and surface anything
 * they flag through the `[mystra]` warning channel — never by throwing.
 *
 * Policy: validation here is purely *advisory*. A malformed spec (a dangling
 * `from:`, an unknown decision in a `when:`, a narrative anchor pointing at a
 * non-existent element) should be reported loudly, but rendering must still
 * proceed on whatever the resolver can make of the tree — a missing field is
 * far better diagnosed by a clear warning than by an opaque late crash. So both
 * `SemanticError`s and `NarrativeWarning`s are emitted as warnings, and *no*
 * validator outcome aborts the load.
 *
 * @astra-spec/sdk is still v0.0.x, so the validators themselves are not yet
 * load-bearing: a validator that throws on some shape it didn't anticipate must
 * not take rendering down with it. Each call is therefore wrapped in try/catch
 * and a throwing validator is itself downgraded to a single warning.
 */
function reportValidation(projectDir: string, raw: RawSpec): void {
  const opts = { basePath: projectDir };

  // Each entry is a validator (semantic or narrative). Their results all expose
  // `.code`, `.message`, `.path?` and a `toString()`, so one loop handles both
  // `SemanticError[]` and `NarrativeWarning[]`.
  const checks: Array<[name: string, run: () => Array<{ toString(): string }>]> = [
    ['validateAnalysis', () => validateAnalysis(raw, opts)],
    ['validateNarrativeAnchors', () => validateNarrativeAnchors(raw, opts)],
    ['checkNarrativeCoverage', () => checkNarrativeCoverage(raw, opts)],
    ['validateNarrativeSections', () => validateNarrativeSections(raw, opts)],
  ];

  for (const [name, run] of checks) {
    let items: Array<{ toString(): string }>;
    try {
      items = run();
    } catch (err) {
      // The validator itself blew up — downgrade to a warning and move on.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[mystra] ${name} could not run (skipped): ${message}`);
      continue;
    }
    for (const item of items) {
      console.warn(`[mystra] ${name}: ${item.toString()}`);
    }
  }

  // JSON-schema validation is opt-in (ASTRA_VALIDATE_SCHEMA): it is async and,
  // absent a pinned schema, fetches one from astra-spec.org over the network.
  // loadASTRASource is synchronous, so we cannot await it — fire-and-forget and
  // let any findings land on the warning channel out of band. This is strictly
  // best-effort and off by default; pinning/bundling the schema (via the SDK's
  // setAstraSchema) would let us make it synchronous and on-by-default later.
  if (process.env.ASTRA_VALIDATE_SCHEMA) {
    validateAnalysisData(raw)
      .then((errs) => errs.forEach((e) => console.warn(`[mystra] schema: ${e}`)))
      .catch((err) =>
        console.warn(
          `[mystra] schema validation unavailable: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }
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
