/**
 * Orchestrates loading of all ASTRA source data.
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadAnalysis } from './yaml-loader.js';
import { loadUniverses, selectUniverse } from './universe-loader.js';
import { scanResults } from './result-scanner.js';
import type { ASTRASource } from '../transform/index.js';

export function loadASTRASource(
  projectDir: string,
  universeName?: string,
): ASTRASource {
  const astraPath = join(projectDir, 'astra.yaml');
  if (!existsSync(astraPath)) {
    throw new Error(`No astra.yaml found in ${projectDir}`);
  }

  const analysis = loadAnalysis(astraPath);

  const universesDir = join(projectDir, 'universes');
  const universes = loadUniverses(universesDir);
  const universe = selectUniverse(universes, universeName);

  const results = scanResults(projectDir, universe.id);

  return { analysis, universe, results, projectDir };
}

export { loadAnalysis } from './yaml-loader.js';
export { loadUniverses, selectUniverse } from './universe-loader.js';
export { scanResults } from './result-scanner.js';
