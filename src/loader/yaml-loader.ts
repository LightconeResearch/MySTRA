/**
 * Loads and parses astra.yaml files.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import yaml from 'js-yaml';
import type { ASTRAAnalysis } from '../types/astra.js';

/**
 * Load an astra.yaml file, recursively resolving sub-analyses with `path` fields.
 */
export function loadAnalysis(filePath: string): ASTRAAnalysis {
  const content = readFileSync(filePath, 'utf-8');
  const data = yaml.load(content) as ASTRAAnalysis;

  // Ensure dictionaries default to empty objects
  if (!data.decisions) data.decisions = {};
  if (!data.prior_insights) data.prior_insights = {};
  if (!data.findings) data.findings = {};

  // Recursively resolve sub-analyses with `path` fields
  if (data.analyses) {
    const baseDir = dirname(filePath);
    for (const [id, sub] of Object.entries(data.analyses)) {
      if (sub.path) {
        const subPath = resolve(baseDir, sub.path, 'astra.yaml');
        data.analyses[id] = loadAnalysis(subPath);
      } else {
        // Inline sub-analysis — ensure defaults
        if (!sub.decisions) sub.decisions = {};
        if (!sub.prior_insights) sub.prior_insights = {};
        if (!sub.findings) sub.findings = {};
      }
    }
  }

  return data;
}
