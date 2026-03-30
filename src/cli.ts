#!/usr/bin/env node

/**
 * MySTRA CLI — Live ASTRA document rendering via MyST.
 */

import { resolve } from 'node:path';
import { Command } from 'commander';
import { createContentServer } from './server/index.js';
import { launchTheme } from './theme/launcher.js';
import type { ChildProcess } from 'node:child_process';

const program = new Command();

program
  .name('mystra')
  .description('Live ASTRA document rendering via MyST')
  .version('0.1.0')
  .argument('[project-dir]', 'Path to ASTRA project directory', '.')
  .option('-p, --port <number>', 'Theme server port', '3000')
  .option('--content-port <number>', 'Content server port', '3100')
  .option('-u, --universe <name>', 'Specific universe to view')
  .option('--no-theme', 'Start content server only')
  .action(async (projectDirArg: string, opts: any) => {
    const projectDir = resolve(projectDirArg);
    const themePort = parseInt(opts.port, 10);
    const contentPort = parseInt(opts.contentPort, 10);
    const universeName: string | undefined = opts.universe;
    const useTheme: boolean = opts.theme !== false;

    console.log(`[mystra] Starting MySTRA for ${projectDir}`);

    // Start content server (DOI resolution runs in the background inside)
    const server = createContentServer({
      projectDir,
      contentPort,
      universeName,
    });

    await server.start();

    // Launch theme server
    let themeProcess: ChildProcess | null = null;
    if (useTheme) {
      themeProcess = await launchTheme({ themePort, contentPort, projectDir });
      if (themeProcess) {
        console.log(
          `\n  MySTRA is running:\n` +
          `    Document:  http://localhost:${themePort}\n` +
          `    Content:   http://localhost:${contentPort}\n`,
        );
      }
    } else {
      console.log(
        `\n  MySTRA content server running:\n` +
        `    Content:   http://localhost:${contentPort}\n` +
        `    Config:    http://localhost:${contentPort}/config.json\n`,
      );
    }

    // Graceful shutdown
    const shutdown = () => {
      console.log('\n[mystra] Shutting down...');
      if (themeProcess) {
        themeProcess.kill();
      }
      server.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program.parse();
