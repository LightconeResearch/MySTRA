/**
 * Versioned, browser-safe inventory data for the ASTRA project.
 *
 * Records stay in the scope that declares them. The theme presents this data;
 * it does not parse ASTRA or infer ownership itself.
 */

import { realpathSync } from 'node:fs';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import type {
  Analysis,
  Decision,
  Evidence,
  Input,
  Insight,
  Output,
  Universe,
} from '@astra-spec/sdk';
import {
  resolveArtifact,
  type ASTRASource,
  type ArtifactResolver,
} from './loader.js';
import {
  buildResolvedStore,
  type SerializedDecision,
  type SerializedInput,
  type SerializedOutput,
} from './transform/resolved-store.js';
import { narrow, pageFrames } from './transform/provenance.js';

export const INVENTORY_SNAPSHOT_VERSION = 1 as const;

export type InventoryKind =
  | 'input'
  | 'decision'
  | 'output'
  | 'finding'
  | 'prior_insight';

export interface InventoryEvidence {
  artifact?: string;
  doi?: string;
  quote?: string;
  page?: number;
}

export interface InventoryRecordBase {
  id: string;
  /** Canonical root-relative ASTRA path, including the collection segment. */
  path: string;
  kind: InventoryKind;
  label?: string;
  description?: string;
}

export type InventoryInputRecord = InventoryRecordBase &
  SerializedInput & {
    kind: 'input';
    ref?: string;
  };

export type InventoryOutputRecord = InventoryRecordBase &
  SerializedOutput & {
    kind: 'output';
  };

export type InventoryDecisionRecord = InventoryRecordBase &
  SerializedDecision & {
    kind: 'decision';
    tags?: string[];
    from?: string;
    when?: string[];
  };

export type InventoryFindingRecord = InventoryRecordBase & {
  kind: 'finding';
  claim?: string;
  notes?: string;
  scope?: string;
  evidence?: InventoryEvidence[];
};

export type InventoryPriorInsightRecord = InventoryRecordBase & {
  kind: 'prior_insight';
  claim?: string;
  notes?: string;
  scope?: string;
  evidence?: InventoryEvidence[];
};

export type InventoryRecord =
  | InventoryInputRecord
  | InventoryOutputRecord
  | InventoryDecisionRecord
  | InventoryFindingRecord
  | InventoryPriorInsightRecord;

export interface InventoryScope {
  /** Empty for root, otherwise the canonical dot-separated analysis path. */
  id: string;
  name: string;
  /** Empty string denotes the root parent of a top-level child. */
  parent?: string;
  children: string[];
  records: InventoryRecord[];
}

export interface InventorySnapshotV1 {
  version: typeof INVENTORY_SNAPSHOT_VERSION;
  analysis: {
    id: string;
    name: string;
  };
  scopes: InventoryScope[];
}

interface ScopeBuildContext {
  analysis: Analysis;
  universe: Universe;
  path: string[];
  directory: string;
  ancestors: Analysis[];
}

function scopeId(path: string[]): string {
  return path.join('.');
}

function recordPath(path: string[], collection: string, id: string): string {
  return [...path, collection, id].join('.');
}

function childDirectory(parentDir: string, child: Analysis): string {
  if (!child.path) return parentDir;
  const location = resolve(parentDir, child.path.replace(/^\.\//, ''));
  return /\.ya?ml$/i.test(extname(location)) ? dirname(location) : location;
}

/** Resolve symlinks before asserting that a publishable artifact is in-project. */
function safeProjectRelative(
  projectRoot: string,
  absolutePath: string,
): string | undefined {
  try {
    const path = relative(realpathSync(projectRoot), realpathSync(absolutePath));
    if (!path || path === '..' || path.startsWith(`..${sep}`)) return undefined;
    return path.split(sep).join('/');
  } catch {
    return undefined;
  }
}

function isOutputId(value: string): boolean {
  return Boolean(value)
    && value !== '.'
    && value !== '..'
    && basename(value) === value;
}

function activeChildUniverse(parent: Universe, childId: string): Universe {
  const child = narrow(parent, childId);
  return {
    id: parent.id,
    description: parent.description,
    decisions: child.decisions,
    analyses: child.analyses as Universe['analyses'],
  };
}

function parentInputMaps(ancestors: Analysis[]): Map<string, Input>[] {
  return ancestors.map(
    (analysis) => new Map((analysis.inputs ?? []).map((input) => [input.id, input])),
  );
}

function inheritedInsights(
  ancestors: Analysis[],
  analysis: Analysis,
): Record<string, Insight> {
  return Object.assign(
    {},
    ...ancestors.map((ancestor) => ancestor.prior_insights ?? {}),
    analysis.prior_insights ?? {},
  );
}

function serializeEvidence(
  evidence: Evidence[] | undefined,
): InventoryEvidence[] | undefined {
  const serialized = (evidence ?? [])
    .map((item) => ({
      artifact: item.artifact,
      doi: item.doi,
      quote: item.quote?.exact,
      page: item.location?.page,
    }))
    .filter((item) => item.artifact || item.doi || item.quote || item.page != null);
  return serialized.length ? serialized : undefined;
}

function inputRecord(
  scopePath: string[],
  source: Input,
  stored: SerializedInput,
): InventoryInputRecord {
  return {
    ...stored,
    kind: 'input',
    path: recordPath(scopePath, 'inputs', source.id),
    ref: source.ref,
  };
}

function outputRecord(
  scopePath: string[],
  source: Output,
  stored: SerializedOutput,
): InventoryOutputRecord {
  return {
    ...stored,
    kind: 'output',
    path: recordPath(scopePath, 'outputs', source.id),
  };
}

function serializeDeclaredDecision(
  id: string,
  decision: Decision,
): SerializedDecision {
  const options = Object.fromEntries(
    Object.entries(decision.options ?? {}).map(([optionId, option]) => [
      optionId,
      option.label,
    ]),
  );
  const optionInsights = Object.fromEntries(
    Object.entries(decision.options ?? {})
      .filter(([, option]) => option.insights?.length)
      .map(([optionId, option]) => [optionId, [...(option.insights ?? [])]]),
  );
  return {
    id,
    label: decision.label,
    rationale: decision.rationale,
    options,
    option_insights: Object.keys(optionInsights).length ? optionInsights : undefined,
  };
}

function decisionRecord(
  scopePath: string[],
  id: string,
  source: Decision,
  stored?: SerializedDecision,
): InventoryDecisionRecord {
  return {
    ...(stored ?? serializeDeclaredDecision(id, source)),
    kind: 'decision',
    path: recordPath(scopePath, 'decisions', id),
    tags: source.tags?.length ? [...source.tags] : undefined,
    from: source.from,
    when: source.when?.length ? [...source.when] : undefined,
  };
}

function findingRecord(
  scopePath: string[],
  id: string,
  source: Insight,
): InventoryFindingRecord {
  return {
    id,
    path: recordPath(scopePath, 'findings', id),
    kind: 'finding',
    label: source.label,
    claim: source.claim,
    notes: source.notes,
    scope: source.scope,
    evidence: serializeEvidence(source.evidence),
  };
}

function insightRecord(
  scopePath: string[],
  id: string,
  source: Insight,
): InventoryPriorInsightRecord {
  return {
    id,
    path: recordPath(scopePath, 'prior_insights', id),
    kind: 'prior_insight',
    label: source.label,
    claim: source.claim,
    notes: source.notes,
    scope: source.scope,
    evidence: serializeEvidence(source.evidence),
  };
}

/**
 * Build the project payload consumed by the inventory view.
 *
 * Every declared record appears exactly once in its owning scope. Inherited
 * insights remain relationships instead of becoming duplicate records.
 */
export function buildInventorySnapshot(
  source: ASTRASource,
  projectRoot: string,
): InventorySnapshotV1 {
  const scopes: InventoryScope[] = [];

  const visit = ({
    analysis,
    universe,
    path,
    directory,
    ancestors,
  }: ScopeBuildContext): void => {
    const results: ArtifactResolver = (id) => {
      if (!isOutputId(id)) return undefined;
      const artifact = resolveArtifact(directory, source.universe.id, id);
      if (artifact && !safeProjectRelative(projectRoot, artifact)) return undefined;
      return artifact;
    };

    const store = buildResolvedStore(
      analysis,
      universe,
      results,
      path.length ? path.join('/') : 'index',
      (artifact) => safeProjectRelative(projectRoot, artifact)!,
      parentInputMaps(ancestors),
      inheritedInsights(ancestors, analysis),
      pageFrames([...ancestors, analysis], source.universe, path),
    );

    const records: InventoryRecord[] = [];
    for (const input of analysis.inputs ?? []) {
      records.push(inputRecord(path, input, store.inputs[input.id] ?? { id: input.id }));
    }

    for (const output of analysis.outputs ?? []) {
      const stored = store.outputs[output.id] ?? {
        id: output.id,
        label: output.label,
        type: output.type,
        description: output.description,
        from: output.from,
      };
      records.push(outputRecord(path, output, stored));
    }

    for (const [id, decision] of Object.entries(analysis.decisions ?? {})) {
      records.push(decisionRecord(path, id, decision, store.decisions[id]));
    }
    for (const [id, finding] of Object.entries(analysis.findings ?? {})) {
      records.push(findingRecord(path, id, finding));
    }
    for (const [id, insight] of Object.entries(analysis.prior_insights ?? {})) {
      records.push(insightRecord(path, id, insight));
    }

    const childEntries = Object.entries(analysis.analyses ?? {});
    scopes.push({
      id: scopeId(path),
      name: analysis.name ?? analysis.id ?? path.at(-1) ?? 'Analysis',
      parent: path.length ? scopeId(path.slice(0, -1)) : undefined,
      children: childEntries.map(([id]) => scopeId([...path, id])),
      records,
    });

    for (const [id, child] of childEntries) {
      visit({
        analysis: child,
        universe: activeChildUniverse(universe, id),
        path: [...path, id],
        directory: childDirectory(directory, child),
        ancestors: [...ancestors, analysis],
      });
    }
  };

  visit({
    analysis: source.analysis,
    universe: source.universe,
    path: [],
    directory: projectRoot,
    ancestors: [],
  });

  return {
    version: INVENTORY_SNAPSHOT_VERSION,
    analysis: {
      id: source.analysis.id ?? 'root',
      name: source.analysis.name ?? source.analysis.id ?? 'ASTRA analysis',
    },
    scopes,
  };
}

export function inventoryImageRecords(
  snapshot: InventorySnapshotV1,
): InventoryOutputRecord[] {
  return snapshot.scopes.flatMap((scope) =>
    scope.records.filter(
      (record): record is InventoryOutputRecord =>
        record.kind === 'output'
        && typeof record.resolved_path === 'string'
        && /\.(png|jpe?g|gif|webp|svg)$/i.test(record.resolved_path),
    ),
  );
}
