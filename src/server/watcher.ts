/**
 * File watcher for live reload.
 */

import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';

export function startWatcher(
  projectDir: string,
  onReload: () => void,
): FSWatcher {
  const resultExts = ['png', 'jpg', 'jpeg', 'svg', 'csv', 'json', 'md'];
  const resultGlobs = resultExts.flatMap((ext) => [
    `${projectDir}/results/**/*.${ext}`,
    `${projectDir}/analyses/**/results/**/*.${ext}`,
  ]);

  const watcher = chokidar.watch(
    [
      `${projectDir}/astra.yaml`,
      `${projectDir}/analyses/**/astra.yaml`,
      `${projectDir}/universes/*.yaml`,
      `${projectDir}/universes/*.yml`,
      ...resultGlobs,
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
