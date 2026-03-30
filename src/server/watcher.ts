/**
 * File watcher for live reload.
 */

import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';

export function startWatcher(
  projectDir: string,
  onReload: () => void,
): FSWatcher {
  const watcher = chokidar.watch(
    [
      `${projectDir}/astra.yaml`,
      `${projectDir}/universes/*.yaml`,
      `${projectDir}/universes/*.yml`,
      `${projectDir}/results/**/*.png`,
      `${projectDir}/results/**/*.jpg`,
      `${projectDir}/results/**/*.csv`,
      `${projectDir}/results/**/*.json`,
      `${projectDir}/results/**/*.md`,
    ],
    {
      ignoreInitial: true,
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.mystra-cache/**',
        '**/.dagster/**',
      ],
    },
  );

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  watcher.on('all', (_event, _path) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      onReload();
    }, 300);
  });

  return watcher;
}
