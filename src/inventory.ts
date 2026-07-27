/**
 * Versioned, browser-safe project inventory data.
 *
 * The inventory does not resolve ASTRA independently. It selects each scope's
 * declared records from the same resolved stores emitted on normal pages, then
 * applies only project-payload concerns such as the aggregate preview budget.
 */

import type { ASTRASource } from './loader.js';
import {
  buildResolvedProject,
  buildScopeStore,
  type ResolvedProject,
  type ResolvedProjectScope,
} from './project.js';
import type {
  ResolvedStore,
  SerializedDecision,
  SerializedFinding,
  SerializedInput,
  SerializedInsight,
  SerializedOutput,
} from './transform/resolved-store.js';
import {
  buildTablePreview,
  type SerializedTablePreview,
} from './transform/table-preview.js';

export const INVENTORY_SNAPSHOT_VERSION = 1 as const;

/** Aggregate budget for table previews in the project-wide payload. */
export const INVENTORY_TABLE_PREVIEW_BUDGET_BYTES = 2 * 1024 * 1024;

export type InventoryKind =
  | 'input'
  | 'decision'
  | 'output'
  | 'finding'
  | 'prior_insight';

export type InventoryInputRecord = SerializedInput;
export type InventoryDecisionRecord = SerializedDecision;
export type InventoryFindingRecord = SerializedFinding;
export type InventoryPriorInsightRecord = SerializedInsight;
export type InventoryOutputRecord = SerializedOutput & {
  /** Present when the aggregate inventory budget could not include a preview. */
  table_preview_omitted?: 'project_size_budget';
};

export type InventoryRecord =
  | InventoryInputRecord
  | InventoryDecisionRecord
  | InventoryOutputRecord
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

function declaredRecords(
  scope: ResolvedProjectScope,
  store: ResolvedStore,
): InventoryRecord[] {
  return [
    ...(scope.analysis.inputs ?? []).flatMap((input) => {
      const record = store.inputs[input.id];
      return record ? [record] : [];
    }),
    ...(scope.analysis.outputs ?? []).flatMap((output) => {
      const record = store.outputs[output.id];
      return record ? [record] : [];
    }),
    ...Object.keys(scope.analysis.decisions ?? {}).flatMap((id) => {
      const record = store.decisions[id];
      return record ? [record] : [];
    }),
    ...Object.keys(scope.analysis.findings ?? {}).flatMap((id) => {
      const record = store.findings[id];
      return record ? [record] : [];
    }),
    ...Object.keys(scope.analysis.prior_insights ?? {}).flatMap((id) => {
      const record = store.prior_insights[id];
      return record ? [record] : [];
    }),
  ];
}

function fitPreview(
  preview: SerializedTablePreview,
  remainingBytes: number,
): SerializedTablePreview | undefined {
  if (preview.serialized_bytes <= remainingBytes) return preview;
  return buildTablePreview(
    {
      headers: preview.headers,
      rows: preview.rows,
      totalRows: preview.total_rows,
      totalColumns: preview.total_columns,
      truncated: preview.truncated,
    },
    remainingBytes,
  );
}

function applyProjectPreviewBudget(
  records: InventoryRecord[],
  usedBytes: { value: number },
): InventoryRecord[] {
  return records.map((record) => {
    if (record.kind !== 'output' || !record.table_preview) return record;
    const remaining = Math.max(
      0,
      INVENTORY_TABLE_PREVIEW_BUDGET_BYTES - usedBytes.value,
    );
    const preview = fitPreview(record.table_preview, remaining);
    if (!preview) {
      return {
        ...record,
        table_preview: undefined,
        table_preview_omitted: 'project_size_budget',
      };
    }
    usedBytes.value += preview.serialized_bytes;
    return preview === record.table_preview
      ? record
      : { ...record, table_preview: preview };
  });
}

function isResolvedProject(
  value: ASTRASource | ResolvedProject,
): value is ResolvedProject {
  return 'scopes' in value && 'scopeById' in value;
}

export function buildInventorySnapshot(
  project: ResolvedProject,
  rootStore?: ResolvedStore,
): InventorySnapshotV1;
export function buildInventorySnapshot(
  source: ASTRASource,
  projectRoot: string,
): InventorySnapshotV1;
export function buildInventorySnapshot(
  sourceOrProject: ASTRASource | ResolvedProject,
  rootOrStore?: string | ResolvedStore,
): InventorySnapshotV1 {
  const project = isResolvedProject(sourceOrProject)
    ? sourceOrProject
    : buildResolvedProject(sourceOrProject, rootOrStore as string);
  const rootStore =
    isResolvedProject(sourceOrProject) && typeof rootOrStore === 'object'
      ? rootOrStore
      : undefined;
  const usedPreviewBytes = { value: 0 };

  const scopes = project.scopes.map((scope): InventoryScope => {
    const store =
      scope.id === '' && rootStore ? rootStore : buildScopeStore(scope);
    return {
      id: scope.id,
      name: scope.name,
      parent: scope.parent,
      children: scope.children,
      records: applyProjectPreviewBudget(
        declaredRecords(scope, store),
        usedPreviewBytes,
      ),
    };
  });

  return {
    version: INVENTORY_SNAPSHOT_VERSION,
    analysis: {
      id: project.source.analysis.id ?? 'root',
      name:
        project.source.analysis.name
        ?? project.source.analysis.id
        ?? 'ASTRA analysis',
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

/** Every distinct DOI referenced by inventory evidence, across all scopes. */
export function inventoryEvidenceDois(snapshot: InventorySnapshotV1): string[] {
  const dois = new Map<string, string>();
  for (const scope of snapshot.scopes) {
    for (const record of scope.records) {
      if (!('evidence' in record)) continue;
      for (const evidence of record.evidence ?? []) {
        const doi = evidence.doi?.trim();
        if (doi) dois.set(doi.toLowerCase(), doi);
      }
    }
  }
  return [...dois.values()];
}
