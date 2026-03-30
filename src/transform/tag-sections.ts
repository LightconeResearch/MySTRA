/**
 * Maps decision tags to human-readable method section headings
 * and groups decisions into sections.
 */

import type { ASTRADecision } from '../types/astra.js';
import { toSlug } from '../utils/slug.js';

export const TAG_TO_SECTION: Record<string, string> = {
  'reddening': 'Reddening & Extinction',
  'extinction': 'Reddening & Extinction',
  'sample-selection': 'Sample Construction',
  'foreground': 'Sample Construction',
  'trgb-algorithm': 'TRGB Detection Algorithm',
  'data-processing': 'Data Quality & Processing',
  'photometry': 'Data Quality & Processing',
  'metallicity': 'Calibration & Systematics',
  'calibration': 'Calibration & Systematics',
  'spatial-analysis': 'Calibration & Systematics',
  'uncertainty': 'Calibration & Systematics',
  'fitting': 'Fitting Configuration',
  'reconstruction': 'Reconstruction',
  'template': 'Template Construction',
  'statistics': 'Statistical Methods',
};

export interface DecisionGroup {
  sectionLabel: string;
  sectionId: string;
  decisions: Array<{ id: string; decision: ASTRADecision }>;
}

/**
 * Group decisions by their first tag using the TAG_TO_SECTION mapping.
 * Decisions with unmapped tags go under "Other".
 * Decisions with no tags go under "General".
 */
export function groupDecisionsByTag(
  decisions: Record<string, ASTRADecision>,
): DecisionGroup[] {
  const groupMap = new Map<string, DecisionGroup>();

  for (const [id, decision] of Object.entries(decisions)) {
    // Skip parent reference decisions
    if (decision.from) continue;

    const firstTag = decision.tags?.[0];
    let sectionLabel: string;

    if (!firstTag) {
      sectionLabel = 'General';
    } else {
      sectionLabel = TAG_TO_SECTION[firstTag] ?? 'Other';
    }

    let group = groupMap.get(sectionLabel);
    if (!group) {
      group = {
        sectionLabel,
        sectionId: toSlug(sectionLabel),
        decisions: [],
      };
      groupMap.set(sectionLabel, group);
    }
    group.decisions.push({ id, decision });
  }

  return Array.from(groupMap.values());
}
