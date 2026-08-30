/**
 * The small piece of effective MyST configuration needed by a document-stage
 * plugin.
 *
 * MyST currently creates a fresh VFile for document transforms without
 * attaching the resolved page frontmatter. Prefer that host-owned value when
 * it is available, but fall back to the same local project/page sources MyST
 * reads today. This keeps the workaround isolated so it can disappear when
 * the plugin API exposes effective frontmatter directly.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface MystMathMacro {
  macro: string;
  title?: string;
  description?: string;
}

export type MystMathMacros = Record<string, MystMathMacro>;

export interface EffectiveMystConfig {
  project?: Record<string, unknown>;
  site?: Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function yamlRecord(source: string): Record<string, unknown> | undefined {
  try {
    return record(parseYaml(source, { merge: true }));
  } catch {
    return undefined;
  }
}

function fillProjectConfig(
  base: Record<string, unknown>,
  filler: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...filler, ...base };
  const fillerMath = record(filler.math);
  const baseMath = record(base.math);
  if (fillerMath || baseMath) {
    merged.math = { ...(fillerMath ?? {}), ...(baseMath ?? {}) };
  }
  return merged;
}

function fillSiteConfig(
  base: Record<string, unknown>,
  filler: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...filler, ...base };
  const fillerOptions = record(filler.options);
  const baseOptions = record(base.options);
  if (fillerOptions || baseOptions) {
    merged.options = { ...(fillerOptions ?? {}), ...(baseOptions ?? {}) };
  }
  return merged;
}

function fillConfig(
  base: EffectiveMystConfig,
  filler: EffectiveMystConfig,
): EffectiveMystConfig {
  return {
    ...(base.project || filler.project
      ? {
        project: fillProjectConfig(base.project ?? {}, filler.project ?? {}),
      }
      : {}),
    ...(base.site || filler.site
      ? { site: fillSiteConfig(base.site ?? {}, filler.site ?? {}) }
      : {}),
  };
}

function extendFiles(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.every((candidate) => typeof candidate === 'string')
    ? values as string[]
    : undefined;
}

function isRemoteConfig(value: string): boolean {
  try {
    return new URL(value).protocol.includes('http');
  } catch {
    return false;
  }
}

/**
 * MyST resolves remote config extensions into this cache before loading
 * document plugins. Reusing that host-owned copy keeps us offline-safe and
 * ensures we inspect the exact bytes MyST validated, rather than fetching a
 * second potentially different response.
 */
function remoteConfigCacheFile(root: string, url: string): string | undefined {
  try {
    const hash = createHash('md5').update(url).digest('hex');
    const extension = extname(new URL(url).pathname);
    return join(root, '_build', 'cache', `config-item-${hash}${extension}`);
  } catch {
    return undefined;
  }
}

function extensionFile(root: string, declaringFile: string, extension: string): string | undefined {
  return isRemoteConfig(extension)
    ? remoteConfigCacheFile(root, extension)
    : resolve(dirname(declaringFile), extension);
}

function configFromFile(
  root: string,
  path: string,
  stack: Set<string>,
): EffectiveMystConfig | undefined {
  const file = resolve(path);
  if (stack.has(file)) return undefined;
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = yamlRecord(readFileSync(file, 'utf-8'));
  } catch {
    return undefined;
  }
  if (!parsed) return undefined;

  const project = parsed.project === undefined ? undefined : record(parsed.project);
  const site = parsed.site === undefined ? undefined : record(parsed.site);
  if ((parsed.project !== undefined && !project) || (parsed.site !== undefined && !site)) {
    return undefined;
  }
  const extensions = extendFiles(parsed.extend ?? parsed.extends);
  if (!extensions) return undefined;

  stack.add(file);
  try {
    let config: EffectiveMystConfig = {};
    for (const extension of extensions) {
      const inheritedFile = extensionFile(root, file, extension);
      const inherited = inheritedFile
        ? configFromFile(root, inheritedFile, stack)
        : undefined;
      // Invalid config already stops MyST before document transforms run. If a
      // standalone caller cannot see an inherited file, retain the declaring
      // config instead of also discarding its valid local values.
      if (!inherited) continue;
      config = fillConfig(inherited, config);
    }
    return fillConfig({ project, site }, config);
  } finally {
    stack.delete(file);
  }
}

function commandConfigFile(): string | undefined {
  for (let index = process.argv.length - 1; index >= 0; index -= 1) {
    const argument = process.argv[index]!;
    if (argument.startsWith('--config=')) return argument.slice('--config='.length);
    if (argument === '--config') return process.argv[index + 1];
  }
  return undefined;
}

function configuredRootFiles(root: string): string[] {
  const custom = commandConfigFile();
  return custom
    ? [isAbsolute(custom) ? custom : join(root, custom)]
    : ['myst.yml', 'myst.yaml'].map((filename) => join(root, filename));
}

/**
 * Read the effective MyST project/site values available to document plugins.
 *
 * MyST does not currently attach its resolved config to document-stage
 * VFiles, so follow its `extend` chain and its base/filler precedence here:
 * later extensions override earlier ones, and the declaring file overrides
 * all of them. Math macros and site options are merged maps, as in MyST's
 * `fillProjectFrontmatter` and `fillSiteFrontmatter` helpers.
 */
export function effectiveMystConfig(root: string): EffectiveMystConfig | undefined {
  for (const filename of configuredRootFiles(root)) {
    const config = configFromFile(root, filename, new Set());
    if (config) return config;
  }
  return undefined;
}

function markdownFrontmatter(source: string): Record<string, unknown> | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  return block ? yamlRecord(block[1]!) : undefined;
}

function notebookFrontmatter(source: string): Record<string, unknown> | undefined {
  try {
    const notebook = record(JSON.parse(source));
    if (!notebook) return undefined;
    const metadata = record(notebook.metadata) ?? {};
    const cells = Array.isArray(notebook.cells) ? notebook.cells : [];
    const firstCell = record(cells[0]);
    const cellSource = firstCell?.cell_type === 'markdown'
      ? Array.isArray(firstCell.source)
        ? firstCell.source.map(String).join('')
        : String(firstCell.source ?? '')
      : '';
    const cell = markdownFrontmatter(cellSource) ?? {};
    const metadataMath = record(metadata.math);
    const cellMath = record(cell.math);
    return {
      ...metadata,
      ...cell,
      ...(metadataMath || cellMath
        ? { math: { ...(metadataMath ?? {}), ...(cellMath ?? {}) } }
        : {}),
    };
  } catch {
    return undefined;
  }
}

/** Read page frontmatter that MyST has already removed before plugin transforms. */
export function rawPageFrontmatter(path: string | undefined): Record<string, unknown> | undefined {
  if (!path) return undefined;
  let source: string;
  try {
    source = readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith('.ipynb')) return notebookFrontmatter(source);
  if (lowerPath.endsWith('.myst.json')) {
    try {
      return record(record(JSON.parse(source))?.frontmatter);
    } catch {
      return undefined;
    }
  }
  return markdownFrontmatter(source);
}

function normalizeMathMacros(value: unknown): MystMathMacros {
  const source = record(value);
  if (!source) return {};
  const macros: MystMathMacros = {};
  for (const [name, candidate] of Object.entries(source)) {
    if (typeof candidate === 'string') {
      macros[name] = { macro: candidate };
      continue;
    }
    const definition = record(candidate);
    if (typeof definition?.macro !== 'string') continue;
    macros[name] = {
      macro: definition.macro,
      ...(typeof definition.title === 'string' ? { title: definition.title } : {}),
      ...(typeof definition.description === 'string'
        ? { description: definition.description }
        : {}),
    };
  }
  return macros;
}

function projectMathMacros(root: string): MystMathMacros {
  return normalizeMathMacros(effectiveMystConfig(root)?.project?.math);
}

/**
 * Resolve the math macros effective for late ASTRA prose.
 *
 * Page definitions override project definitions, matching MyST's
 * `fillPageFrontmatter`. A host-provided, already-resolved frontmatter value
 * wins over both fallback sources.
 */
export function pageMathMacros(root: string, vfile?: any): MystMathMacros | undefined {
  const sourcePath = typeof vfile?.path === 'string'
    ? isAbsolute(vfile.path) ? vfile.path : join(root, vfile.path)
    : undefined;
  const project = projectMathMacros(root);
  const page = normalizeMathMacros(rawPageFrontmatter(sourcePath)?.math);
  const host = normalizeMathMacros(vfile?.data?.frontmatter?.math);
  const macros = { ...project, ...page, ...host };
  return Object.keys(macros).length > 0 ? macros : undefined;
}
