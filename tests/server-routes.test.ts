import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import os from 'node:os';
import { createContentServer, type ContentServer } from '../src/server/index.js';

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate an ephemeral port'));
        return;
      }
      server.close((err) => {
        if (err) reject(err);
        else resolve(address.port);
      });
    });
  });
}

describe('content server routes', () => {
  let projectDir = '';
  let port = 0;
  let server: ContentServer | null = null;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(os.tmpdir(), 'mystra-server-'));
    port = await getFreePort();

    write(
      join(projectDir, 'astra.yaml'),
      `name: Root analysis
narrative:
  summary: Root summary
analyses:
  child:
    name: Child analysis
    narrative:
      summary: Child summary
    outputs:
      - id: child_plot
        type: figure
        description: Child plot
`,
    );
    write(join(projectDir, 'universes', 'baseline.yaml'), `id: baseline\ndecisions: {}\n`);
    write(
      join(projectDir, 'analyses', 'child', 'results', 'baseline', 'child_plot.png'),
      'child-image',
    );

    server = createContentServer({
      projectDir,
      contentPort: port,
      universeName: 'baseline',
    });
    await server.start();
  });

  afterEach(() => {
    server?.close();
    server = null;
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  it('serves nested sub-analysis artifacts through /static and the /astra sidecar', async () => {
    const astraRes = await fetch(`http://127.0.0.1:${port}/astra/child.json`);
    expect(astraRes.status).toBe(200);
    const astra = (await astraRes.json()) as {
      outputs: Array<{ id: string; resolved_path?: string }>;
    };
    expect(astra.outputs).toEqual([
      expect.objectContaining({ id: 'child_plot', resolved_path: '/static/child_plot.png' }),
    ]);

    const staticRes = await fetch(`http://127.0.0.1:${port}/static/child_plot.png`);
    expect(staticRes.status).toBe(200);
    const bytes = Buffer.from(await staticRes.arrayBuffer()).toString('utf-8');
    expect(bytes).toBe('child-image');
  });
});
