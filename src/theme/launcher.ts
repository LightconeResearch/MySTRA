/**
 * Spawns the MyST book-theme as a child process.
 *
 * The theme is a Remix Express app that reads CONTENT_CDN_PORT to know
 * where to fetch page JSON from. We either find an already-downloaded
 * template or download it via `mystmd`.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface ThemeLaunchOptions {
  themePort: number;
  contentPort: number;
  projectDir: string;
}

/**
 * Launch the MyST book-theme directly from its template directory.
 */
export async function launchTheme(options: ThemeLaunchOptions): Promise<ChildProcess | null> {
  const { themePort, contentPort, projectDir } = options;

  const themeDir = await ensureThemeInstalled(projectDir);
  if (!themeDir) {
    console.warn(
      '[mystra] Could not set up theme. Running in content-server-only mode.',
    );
    console.warn(
      `[mystra] Content API available at http://localhost:${contentPort}`,
    );
    return null;
  }

  // Install node_modules if missing
  const nodeModulesDir = join(themeDir, 'node_modules');
  if (!existsSync(nodeModulesDir)) {
    console.log('[mystra] Installing theme dependencies...');
    try {
      execSync('npm install --production', { cwd: themeDir, stdio: 'pipe' });
    } catch (err) {
      console.error('[mystra] Failed to install theme dependencies:', (err as Error).message);
      return null;
    }
  }

  // Launch the theme server
  const child = spawn('node', ['server.js'], {
    cwd: themeDir,
    env: {
      ...process.env,
      HOST: 'localhost',
      PORT: String(themePort),
      CONTENT_CDN_PORT: String(contentPort),
      MODE: 'app',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.log(`[theme] ${line}`);
  });

  child.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.error(`[theme] ${line}`);
  });

  child.on('error', (err) => {
    console.error('[mystra] Theme process error:', err.message);
  });

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[mystra] Theme process exited with code ${code}`);
    }
  });

  return child;
}

/**
 * Find or download the book-theme template.
 *
 * Search order:
 * 1. _build/templates/site/myst/book-theme/ (previously downloaded by mystmd)
 * 2. .mystra-cache/theme/ (our own cache)
 * 3. Download via mystmd if available
 */
async function ensureThemeInstalled(projectDir: string): Promise<string | null> {
  // Check common locations for the template
  const candidates = [
    join(projectDir, '_build', 'templates', 'site', 'myst', 'book-theme'),
    join(process.cwd(), '_build', 'templates', 'site', 'myst', 'book-theme'),
    join(projectDir, '.mystra-cache', 'theme'),
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, 'server.js')) && existsSync(join(dir, 'build', 'index.js'))) {
      console.log(`[mystra] Using theme at ${dir}`);
      return dir;
    }
  }

  // Try to download via mystmd
  console.log('[mystra] Theme not found locally. Downloading via mystmd...');
  const cacheDir = join(projectDir, '.mystra-cache', 'theme');

  try {
    // Use mystmd to fetch the template
    execSync(
      `npx -y mystmd templates list site --json 2>/dev/null || true`,
      { stdio: 'pipe' },
    );

    // Direct download approach: use mystmd's template fetch
    execSync(
      `npx -y mystmd templates fetch site/myst/book-theme --path "${cacheDir}" 2>&1`,
      { stdio: 'pipe', timeout: 60_000 },
    );

    if (existsSync(join(cacheDir, 'server.js'))) {
      return cacheDir;
    }
  } catch {
    // mystmd not available or fetch failed
  }

  // Manual fallback: try npm pack
  try {
    console.log('[mystra] Trying npm-based theme installation...');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(cacheDir, { recursive: true });

    execSync(
      'npm init -y && npm install @myst-theme/book@latest 2>&1',
      { cwd: cacheDir, stdio: 'pipe', timeout: 120_000 },
    );

    // The npm package might have the template files
    const pkgDir = join(cacheDir, 'node_modules', '@myst-theme', 'book');
    if (existsSync(join(pkgDir, 'server.js'))) {
      return pkgDir;
    }
  } catch {
    // npm approach also failed
  }

  console.error(
    '[mystra] Could not download theme.\n' +
    '  Option 1: Run `mystmd start` once in any MyST project to download the theme, then retry.\n' +
    '  Option 2: Install mystmd globally: npm install -g mystmd',
  );

  return null;
}
