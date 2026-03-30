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
  } catch {
    // Directory not readable — return empty map
  }

  return results;
}
