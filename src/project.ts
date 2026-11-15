/** Native SDK boundary for MyST: reports, lookup maps and immutable assets. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import {
  InvalidAnalysisError,
  indexResolvedAnalysis,
  type Diagnostic,
  type ResolvedAnalysis,
  type ResolvedAnalysisIndex,
  type StatusReport,
} from '@astra-spec/sdk';
import {
  resolve,
  status,
  readResults,
  type NodeSourceOptions,
} from '@astra-spec/sdk/node';

export interface PublicationResource {
  /** Absolute immutable path supplied to MyST's resource pipeline. */
  path: string;
  /** SHA-256 of the actual content, independent of provenance state. */
  cacheToken: string;
}

export interface ResolvedProject {
  root: string;
  analysis: ResolvedAnalysis;
  status: StatusReport;
  index: ResolvedAnalysisIndex;
  resources: ReadonlyMap<string, PublicationResource>;
}

// Share concurrent page work only. A later document pass resolves again: Git
// HEAD, dirty input bytes, nested repositories and remote caches all affect the
// reports, so filesystem metadata alone is not a sufficient freshness key.
const inFlight = new Map<string, Promise<ResolvedProject>>();

async function resolveFresh(
  root: string,
  options: NodeSourceOptions,
): Promise<ResolvedProject> {
  const analysis = await resolve(root, options);
  const report = await status(root, options);
  const index = indexResolvedAnalysis(analysis);
  const resources = new Map<string, PublicationResource>();
  // One SDK resolution yields all available content across universes and tries
  // later places when the first one is absent, without retaining all bytes.
  for await (const { result, bytes } of readResults(root, options)) {
    const cacheToken = createHash('sha256').update(bytes).digest('hex');
    const output = index.elementByRef.get(result.output);
    const format =
      output?.collection === 'outputs' ? output.element.format : 'bin';
    const extension = format.replace(/[^a-zA-Z0-9._-]/g, '_') || 'bin';
    const directory = join(root, '_build', 'astra-resources');
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${cacheToken}.${extension}`);
    // Publish complete immutable content atomically; another page or build
    // may already be serving the same hash while this one refreshes.
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    resources.set(result.id, { path, cacheToken });
  }
  return { root, analysis, status: report, index, resources };
}

export function loadResolvedProject(
  root: string,
  options: NodeSourceOptions = {},
): Promise<ResolvedProject> {
  const normalizedRoot = resolvePath(root);
  const sourceOptions = { ...options };
  const key = JSON.stringify([
    normalizedRoot,
    sourceOptions.offline ?? false,
    sourceOptions.cacheDir,
  ]);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = resolveFresh(normalizedRoot, sourceOptions).finally(() => {
    if (inFlight.get(key) === task) inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

/** Forget concurrent-work entries for an explicit host reset. */
export function clearResolvedProjectCache(): void {
  inFlight.clear();
}

function diagnosticLine(issue: Diagnostic): string {
  const at = issue.location;
  const source = [at.file, at.pointer].filter(Boolean).join(':');
  const position =
    at.line === undefined
      ? ''
      : `:${at.line}${at.column === undefined ? '' : `:${at.column}`}`;
  return `${source}${position} [${issue.code}] ${issue.message}`;
}

export function formatProjectError(error: unknown): string[] {
  if (error instanceof InvalidAnalysisError) {
    return error.report.diagnostics.length
      ? error.report.diagnostics.map(diagnosticLine)
      : [error.message];
  }
  return [error instanceof Error ? error.message : String(error)];
}
