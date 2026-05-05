/**
 * Content server — Express app with all routes, static serving,
 * WebSocket, and file watcher.
 */

import { createReadStream, stat } from 'node:fs';
import { createServer as createHTTPServer } from 'node:http';
import { join, resolve, sep } from 'node:path';
import express from 'express';
import cors from 'cors';
import { configHandler } from './routes/config.js';
import { contentHandler } from './routes/content.js';
import { xrefHandler } from './routes/xref.js';
import { astraHandler, buildASTRADataMap, type ASTRAPageData } from './routes/astra.js';
import { WebSocketManager } from './websocket.js';
import { startWatcher } from './watcher.js';
import { loadASTRASource } from '../loader/index.js';
import { buildAllPages } from '../transform/index.js';
import { resolveAllDOIs, type DOIMetadata } from '../doi/resolver.js';
import { buildPaperMetadata, resolvePaperCacheDir } from '../papers/index.js';
import type { ASTRAAnalysis } from '../types/astra.js';
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
  let astraDataMap: Map<string, ASTRAPageData> = new Map();
  let references: References = {};
  let doiMetadata: Map<string, DOIMetadata> = new Map();
  let wsManager: WebSocketManager;
  let activeUniverseId = '';
  let doiReloadToken = 0;

  function reload(): ASTRAAnalysis {
    const source = loadASTRASource(projectDir, universeName);
    activeUniverseId = source.universe.id;
    pages = buildAllPages(
      source.analysis,
      source.universe,
      source.results,
      source.projectDir,
    );
    astraDataMap = buildASTRADataMap(source.analysis, source.results);
    refreshDOIMetadata(source.analysis);
    console.log(
      `[mystra] Loaded: ${pages.length} page(s), universe "${source.universe.id}"`,
    );
    return source.analysis;
  }

  function refreshDOIMetadata(analysis: ASTRAAnalysis) {
    const token = ++doiReloadToken;
    const allDOIs = [...new Set(pages.flatMap((page) => page.dois))];

    if (allDOIs.length === 0) {
      references = {};
      doiMetadata = new Map();
      return;
    }

    const cacheDir = join(projectDir, '.mystra-cache', 'doi');
    const paperCacheDir = resolvePaperCacheDir();
    resolveAllDOIs(allDOIs, cacheDir)
      .then((result) => {
        if (token !== doiReloadToken) return;
        references = result.references;
        doiMetadata = buildPaperMetadata(result.metadata, analysis, paperCacheDir);
        const count = Object.keys(result.references.cite?.data ?? {}).length;
        console.log(`[mystra] Resolved ${count} citation(s)`);
        if (wsManager) {
          wsManager.broadcast({ type: 'RELOAD' });
        }
      })
      .catch((err) => {
        if (token !== doiReloadToken) return;
        console.warn('[mystra] DOI resolution error:', err);
      });
  }

  // Initial load
  reload();

  const siteTitle = pages[0]?.title ?? 'ASTRA Analysis';
  const papersRoot = resolvePaperCacheDir();
  const papersRootAbs = resolve(papersRoot);

  // Express app
  const app = express();
  app.use(cors());

  // API routes
  app.get('/config.json', configHandler(() => pages, siteTitle));
  app.get('/content/*.json', contentHandler(() => pages, () => references));
  app.get('/myst.xref.json', xrefHandler(() => pages));
  app.get('/astra/*.json', astraHandler(() => astraDataMap));

  app.get('/doi-metadata/:doi(*)', (req, res) => {
    const doi = req.params['doi'];
    const meta = doiMetadata.get(doi);
    if (meta) {
      res.json(meta);
    } else {
      res.status(404).json({ error: 'DOI not resolved' });
    }
  });

  app.use('/papers', (req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const rel = urlPath.replace(/^\/+/, '');
    const target = resolve(papersRootAbs, rel);
    if (!target.startsWith(`${papersRootAbs}${sep}`) && target !== papersRootAbs) {
      res.status(403).end('forbidden');
      return;
    }
    stat(target, (err, fileStat) => {
      if (err || !fileStat.isFile()) {
        res.status(404).end('not found');
        return;
      }
      res.status(200);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      createReadStream(target).pipe(res);
    });
  });

  // Static file serving for result images. The universe id is the
  // one captured during the initial reload — no need to re-parse
  // the source just to learn it.
  const staticDir = join(projectDir, 'results', activeUniverseId);
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
      return new Promise<void>((resolveStart) => {
        server.listen(contentPort, () => {
          console.log(
            `[mystra] Content server listening on http://localhost:${contentPort}`,
          );
          resolveStart();
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
