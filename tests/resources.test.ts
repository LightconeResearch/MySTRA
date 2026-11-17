/** The publication boundary consumes lazy SDK chunks, never whole-file reads. */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedAnalysis, Result, StatusReport } from '@astra-spec/sdk';

const sdk = vi.hoisted(() => ({
  resolve: vi.fn(),
  status: vi.fn(),
  resultResources: vi.fn(),
}));
vi.mock('@astra-spec/sdk/node', () => sdk);
import {
  clearResolvedProjectCache,
  loadResolvedProject,
} from '../src/project.js';

const result: Result = {
  id: 'large',
  output: 'outputs.large',
  inputs: [],
  places: [
    {
      address: 'large',
      record_path: '.astra/records/large.json',
      file_path: 'results/large.bin',
    },
  ],
};
const analysis: ResolvedAnalysis = {
  schema_version: 'astra-tools.resolved-analysis.v1',
  spec_version: '0.1.0',
  notes: [],
  results: [result],
  analyses: [
    {
      key: '',
      folder: '.',
      tags: [],
      declares: {},
      inputs: [],
      decisions: [],
      outputs: [
        {
          ref: 'outputs.large',
          type: 'table',
          format: 'bin',
          tags: [],
          decisions: [],
        },
        {
          ref: 'outputs.dataset',
          type: 'data',
          format: 'parquet',
          tags: [],
          decisions: [],
        },
      ],
      prior_insights: [],
      findings: [],
      universes: [],
    },
  ],
};
const status: StatusReport = {
  schema_version: 'astra-tools.status-report.v1',
  statuses: {},
  evidence: [],
  inputs: {},
};
let root: string;

beforeEach(async () => {
  clearResolvedProjectCache();
  root = await mkdtemp(join(tmpdir(), 'mystra-chunks-'));
  sdk.resolve.mockResolvedValue(analysis);
  sdk.status.mockResolvedValue(status);
});
afterEach(async () => {
  clearResolvedProjectCache();
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('publication resource streaming', () => {
  it('hashes and materializes many bounded chunks without reading a whole file', async () => {
    const chunk = Buffer.alloc(64 * 1024, 0x1d);
    const chunkCount = 128;
    let consumed = 0;
    const read = vi.fn(() => {
      throw new Error('whole-file reads are unavailable');
    });
    sdk.resultResources.mockImplementation(async function* () {
      yield {
        result,
        placeIndex: 1,
        read,
        async *chunks() {
          for (let index = 0; index < chunkCount; index += 1) {
            consumed += 1;
            yield chunk;
          }
        },
      };
    });
    const project = await loadResolvedProject(root);
    const resource = project.resources.get(result.id)!;
    const expected = createHash('sha256');
    for (let index = 0; index < chunkCount; index += 1) expected.update(chunk);
    expect(resource.cacheToken).toBe(expected.digest('hex'));
    expect((await stat(resource.path)).size).toBe(chunk.length * chunkCount);
    expect(consumed).toBe(chunkCount);
    expect(read).not.toHaveBeenCalled();
    expect(await readdir(join(root, '_build', 'astra-resources'))).toEqual([
      `${resource.cacheToken}.bin`,
    ]);
  });

  it('removes a failed partial stream and preserves an already published asset', async () => {
    const read = vi.fn(() => {
      throw new Error('whole-file reads are unavailable');
    });
    sdk.resultResources.mockImplementation(async function* () {
      yield {
        result,
        placeIndex: 0,
        read,
        async *chunks() {
          yield Buffer.from('published');
        },
      };
    });
    const first = await loadResolvedProject(root);
    const resource = first.resources.get(result.id)!;
    let closed = false;
    sdk.resultResources.mockImplementation(async function* () {
      yield {
        result,
        placeIndex: 0,
        read,
        async *chunks() {
          try {
            yield Buffer.from('partial replacement');
            throw new Error('stream interrupted');
          } finally {
            closed = true;
          }
        },
      };
    });
    await expect(loadResolvedProject(root)).rejects.toThrow(
      'stream interrupted',
    );
    expect(closed).toBe(true);
    expect(await readFile(resource.path, 'utf8')).toBe('published');
    expect(await readdir(join(root, '_build', 'astra-resources'))).toEqual([
      `${resource.cacheToken}.bin`,
    ]);
    expect(read).not.toHaveBeenCalled();
  });

  it('asks the SDK to skip data results before it looks for their bytes', async () => {
    sdk.resultResources.mockImplementation(async function* () {});
    await loadResolvedProject(root);
    const [, options] = sdk.resultResources.mock.calls[0]!;
    expect(options.filter(result)).toBe(true);
    expect(
      options.filter({ ...result, id: 'dataset', output: 'outputs.dataset' }),
    ).toBe(false);
  });
});
