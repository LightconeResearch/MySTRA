/**
 * Scans the results directory for produced output artifacts.
 */

import { readdirSync, existsSync } from 'node:fs';
import { join, parse as parsePath } from 'node:path';

/**
 * Scan results/<universeId>/ and return a map of output_id -> absolute file path.
 */
export function scanResults(
  projectDir: string,
  universeId: string,
): Map<string, string> {
  const resultsDir = join(projectDir, 'results', universeId);
  const results = new Map<string, string>();

  if (!existsSync(resultsDir)) return results;

  try {
    const files = readdirSync(resultsDir);
    for (const file of files) {
      const parsed = parsePath(file);
      // Skip hidden files and directories
      if (parsed.name.startsWith('.')) continue;
      results.set(parsed.name, join(resultsDir, file));
    }
  } catch (err) {
    // Directory exists but isn't readable. Silently dropping the
    // entire results map would make missing-output admonitions
    // appear for outputs that *are* present — surface the cause
    // so the operator can fix it.
    console.warn(
      `[mystra] Could not read results directory "${resultsDir}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return results;
}
