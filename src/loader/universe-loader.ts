/**
 * Loads universe YAML files from the universes/ directory.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { ASTRAUniverse } from '../types/astra.js';

/**
 * Load all universe files from a directory.
 */
export function loadUniverses(universesDir: string): ASTRAUniverse[] {
  if (!existsSync(universesDir)) return [];

  const files = readdirSync(universesDir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort();

  return files.map((file) => {
    const content = readFileSync(join(universesDir, file), 'utf-8');
    return yaml.load(content) as ASTRAUniverse;
  });
}

/**
 * Select the active universe by name, or default to the first one.
 * If no universes exist, returns a synthetic empty universe.
 */
export function selectUniverse(
  universes: ASTRAUniverse[],
  name?: string,
): ASTRAUniverse {
  if (name) {
    const found = universes.find((u) => u.id === name);
    if (!found) {
      throw new Error(
        `Universe "${name}" not found. Available: ${universes.map((u) => u.id).join(', ')}`,
      );
    }
    return found;
  }

  if (universes.length > 0) {
    return universes[0];
  }

  // Synthetic empty universe when no universe files exist
  return { id: 'default', decisions: {} };
}
