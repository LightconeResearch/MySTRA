/**
 * Content server — Express app with all routes, static serving,
 * WebSocket, and file watcher.
 */

import { createServer as createHTTPServer } from 'node:http';
import { join } from 'node:path';
import express from 'express';
import cors from 'cors';
import { configHandler } from './routes/config.js';
import { contentHandler } from './routes/content.js';
import { xrefHandler } from './routes/xref.js';
import { WebSocketManager } from './websocket.js';
import { startWatcher } from './watcher.js';
import { loadASTRASource } from '../loader/index.js';
import { buildAllPages } from '../transform/index.js';
import { resolveAllDOIs, type DOIMetadata } from '../doi/resolver.js';
import type { PageData, References } from '../types/content-server.js';

export interface ServerOptions {
  projectDir: string;
  contentPort: number;
  universeName?: string;
}

export interface ContentServer {
  start(): Promise<void>;
  close(): void;
  getPages(): PageData[];
}

export function createContentServer(options: ServerOptions): ContentServer {
  const { projectDir, contentPort, universeName } = options;

  let pages: PageData[] = [];
  let references: References = {};
  let doiMetadata: Map<string, DOIMetadata> = new Map();
  let wsManager: WebSocketManager;

  function reload() {
    const source = loadASTRASource(projectDir, universeName);
    pages = buildAllPages(
      source.analysis,
      source.universe,
      source.results,
      source.projectDir,
    );
    console.log(
      `[mystra] Loaded: ${pages.length} page(s), universe "${source.universe.id}"`,
    );
  }

  // Initial load
  reload();

  const siteTitle = pages[0]?.title ?? 'ASTRA Analysis';

  // Kick off DOI resolution in the background
  const allDOIs = pages.flatMap((p) => p.dois);
  if (allDOIs.length > 0) {
    const cacheDir = join(projectDir, '.mystra-cache', 'doi');
    resolveAllDOIs(allDOIs, cacheDir)
      .then((result) => {
        references = result.references;
        doiMetadata = result.metadata;
        const count = Object.keys(result.references.cite?.data ?? {}).length;
        console.log(`[mystra] Resolved ${count} citation(s)`);
        // Notify browsers to reload with citations
        if (wsManager) {
          wsManager.broadcast({ type: 'RELOAD' });
        }
      })
      .catch((err) => {
        console.warn('[mystra] DOI resolution error:', err);
      });
  }

  // Express app
  const app = express();
  app.use(cors());

  // API routes
  app.get('/config.json', configHandler(() => pages, siteTitle));
  app.get('/content/:slug.json', contentHandler(() => pages, () => references));
  app.get('/content/:project/:slug.json', contentHandler(() => pages, () => references));
  app.get('/myst.xref.json', xrefHandler(() => pages));

  // Endpoint to get DOI metadata (used by evidence rendering at request time)
  app.get('/doi-metadata/:doi(*)', (req, res) => {
    const doi = req.params['doi'];
    const meta = doiMetadata.get(doi);
    if (meta) {
      res.json(meta);
    } else {
      res.status(404).json({ error: 'DOI not resolved' });
    }
  });

  // Static file serving for result images
  const source = loadASTRASource(projectDir, universeName);
  const staticDir = join(projectDir, 'results', source.universe.id);
  app.use('/static', express.static(staticDir));

  // HTTP server
  const server = createHTTPServer(app);

  // WebSocket
  wsManager = new WebSocketManager(server);

  // File watcher
  const watcher = startWatcher(projectDir, () => {
    console.log('[mystra] File change detected, reloading...');
    try {
      reload();
      wsManager.broadcast({ type: 'RELOAD' });
    } catch (err) {
      console.error('[mystra] Reload failed:', err);
      wsManager.broadcast({
        type: 'LOG',
        message: `Reload error: ${err}`,
      });
    }
  });

  return {
    start() {
      return new Promise<void>((resolve) => {
        server.listen(contentPort, () => {
          console.log(
            `[mystra] Content server listening on http://localhost:${contentPort}`,
          );
          resolve();
        });
      });
    },

    close() {
      watcher.close();
      wsManager.close();
      server.close();
    },

    getPages() {
      return pages;
    },
  };
}
