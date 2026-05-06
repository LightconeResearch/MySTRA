/**
 * Scans the results directory(ies) for produced output artifacts.
 *
 * Top-level outputs live at `results/<universe>/<id>.<ext>` (the project
 * root). Sub-analysis outputs live at `analyses/<sub>/results/<universe>/...`,
 * mirroring the convention `lightcone-ui-liam/packages/core/src/bundle.ts`
 * uses (`subOutputPath` / `rootOutputPath`).
 *
 * The walker descends `analyses/*` recursively so sub-of-sub results are
 * picked up too. All matches are merged into a single `output_id ->
 * absolute path` map. Output IDs are unique within a single analysis
 * scope; collisions across scopes are last-write-wins (the practical
 * collision risk is low for current reproductions and does not block
 * any existing parity work).
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, parse as parsePath } from 'node:path';

/**
 * Scan a single `results/<universeId>/` directory and merge files into the
 * passed-in map. Files in nested directories are skipped — Liam's pipeline
 * uses a flat `<universe>/` directory per scope and we follow the same
 * shape here. Hidden files / dotfiles are skipped.
 */
function mergeResultsDir(
  resultsDir: string,
  results: Map<string, string>,
): void {
  if (!existsSync(resultsDir)) return;
  try {
    const files = readdirSync(resultsDir);
    for (const file of files) {
      const parsed = parsePath(file);
      if (parsed.name.startsWith('.')) continue;
      const absPath = join(resultsDir, file);
      try {
        if (statSync(absPath).isDirectory()) continue;
      } catch {
        continue;
      }
      results.set(parsed.name, absPath);
    }
  } catch (err) {
    console.warn(
      `[mystra] Could not read results directory "${resultsDir}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Recursively walk `<root>/analyses/*` and scan each sub-analysis's own
 * `results/<universe>/` directory. The directory layout convention follows
 * `lightcone-ui-liam`'s bundle pipeline:
 *
 *   <project>/results/<universe>/...           ← root outputs
 *   <project>/analyses/<sub>/results/<universe>/...  ← sub outputs
 *   <project>/analyses/<sub>/analyses/<grand>/results/<universe>/...  ← deeper
 */
function walkAnalysesDir(
  scopeDir: string,
  universeId: string,
  results: Map<string, string>,
): void {
  const analysesDir = join(scopeDir, 'analyses');
  if (!existsSync(analysesDir)) return;
  let entries: string[];
  try {
    entries = readdirSync(analysesDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const subDir = join(analysesDir, entry);
    try {
      if (!statSync(subDir).isDirectory()) continue;
    } catch {
      continue;
    }
    mergeResultsDir(join(subDir, 'results', universeId), results);
    walkAnalysesDir(subDir, universeId, results);
  }
}

/**
 * Scan the project's results directories (root + every nested
 * sub-analysis) and return a map of output_id -> absolute file path.
 */
export function scanResults(
  projectDir: string,
  universeId: string,
): Map<string, string> {
  const results = new Map<string, string>();
  mergeResultsDir(join(projectDir, 'results', universeId), results);
  walkAnalysesDir(projectDir, universeId, results);
  return results;
}
