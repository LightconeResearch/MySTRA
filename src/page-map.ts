/**
 * Resolve the report pages that explicitly represent ASTRA analyses.
 *
 * Analysis ids are not URLs. A link is available only when `myst.yml` lists a
 * concrete page in `project.toc` and that page maps to a resolved analysis by
 * the same filename/frontmatter rules used for the active page scope. This
 * keeps navigation host-owned and avoids reviving guessed `/<analysis-id>`
 * routes.
 */

import {
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  sep,
} from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AnalysisIndex } from '@astra-spec/sdk';

export type AstraScopeValue = string | string[];

interface TocEntry {
  file?: unknown;
  pattern?: unknown;
  children?: unknown;
}

/** Read the unvalidated page frontmatter MyST strips before plugin transforms. */
function rawFrontmatter(path: string | undefined): Record<string, unknown> | undefined {
  if (!path) return undefined;
  let source: string;
  try {
    source = readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!block) return undefined;
  try {
    const value = parseYaml(block[1]);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    // MyST reports malformed page frontmatter. It is not a page mapping here.
    return undefined;
  }
}

/** The page's explicit `astra_scope`, when it has the documented value shape. */
export function rawAstraScope(path: string | undefined): AstraScopeValue | undefined {
  const value = rawFrontmatter(path)?.astra_scope;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((segment) => String(segment));
  return undefined;
}

function configuredPages(
  root: string,
): { toc: unknown[]; folders: boolean } | undefined {
  for (const filename of ['myst.yml', 'myst.yaml']) {
    try {
      const parsed = parseYaml(readFileSync(join(root, filename), 'utf-8'));
      const toc = parsed?.project?.toc;
      if (Array.isArray(toc)) {
        return {
          toc,
          folders: parsed?.site?.options?.folders === true,
        };
      }
    } catch {
      // MyST owns config diagnostics. Without a readable TOC there is no
      // explicit route that this adapter can safely publish.
    }
  }
  return undefined;
}

function tocFiles(entries: unknown[], files: string[] = []): string[] {
  for (const candidate of entries) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const entry = candidate as TocEntry;
    if (typeof entry.file === 'string') files.push(entry.file);
    if (Array.isArray(entry.children)) tocFiles(entry.children, files);
  }
  return files;
}

function tocHasPattern(entries: unknown[]): boolean {
  return entries.some((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return false;
    }
    const entry = candidate as TocEntry;
    return typeof entry.pattern === 'string' ||
      (Array.isArray(entry.children) && tocHasPattern(entry.children));
  });
}

const SOURCE_EXTENSIONS = ['.md', '.ipynb', '.tex', '.myst.json'] as const;

function resolvePageFile(root: string, configured: string): string | undefined {
  const direct = isAbsolute(configured) ? configured : join(root, configured);
  // MyST accepts extensionless file entries, including dotted basenames such
  // as `reconstruction.features`; try the configured path, then its supported
  // source extensions rather than treating the final dot as an extension.
  const candidates = [
    direct,
    ...SOURCE_EXTENSIONS.map((extension) => `${direct}${extension}`),
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch {
      // An unreadable/missing page cannot provide a verified route.
    }
  }
  return undefined;
}

/**
 * MyST source filename without its supported compound extension.
 *
 * Keep this shared with active-page scope resolution: a page that receives an
 * analysis href must resolve to that same analysis when MyST transforms it.
 */
export function sourceStem(path: string): string {
  const name = basename(path);
  const extension = SOURCE_EXTENSIONS.find((candidate) => name.endsWith(candidate));
  if (extension) return name.slice(0, -extension.length);
  const fallbackExtension = extname(name);
  return fallbackExtension ? name.slice(0, -fallbackExtension.length) : name;
}

/** MyST's stable filename slug rules, reproduced for configured TOC pages. */
function slugPart(input: string): string {
  let value = input;
  if (!/^([12][0-9]{3})([^0-9])?/.test(value) && !/^([0-9]{5})/.test(value)) {
    value = value.replace(/^([0-9_.-]+)/, '') || value;
  }
  return value
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function pageSlug(
  root: string,
  path: string,
  folders: boolean,
  seen: Map<string, number>,
): string {
  const directory = relative(root, dirname(path)).split(sep).filter(Boolean);
  // MyST drops folder segments for a source outside the project root. In
  // particular, never turn `..` into a publishable URL component.
  const pieces = folders && !directory.includes('..')
    ? directory.map(slugPart)
    : [];
  let slug = [...pieces, slugPart(sourceStem(path))].filter(Boolean).join('.');
  const folderIndex = slug.endsWith('.index');
  const key = folderIndex ? slug.slice(0, -'.index'.length) : slug;
  const count = seen.get(key) ?? 0;
  seen.set(key, count + 1);
  if (count > 0) slug = `${key}-${count}${folderIndex ? '.index' : ''}`;
  return slug;
}

function hrefForSlug(slug: string): string {
  const path = slug.replace(/\.index$/, '').replace(/\./g, '/');
  return path ? `/${path}` : '/';
}

function pageAnalysisPath(
  file: string,
  index: AnalysisIndex,
  rootPage: boolean,
): string | undefined {
  const explicit = rawAstraScope(file);
  let segments: string[];
  if (Array.isArray(explicit)) {
    segments = explicit.map(String).filter(Boolean);
  } else if (typeof explicit === 'string') {
    segments = explicit.split('.').filter(Boolean);
  } else {
    const stem = sourceStem(file);
    segments = stem && stem !== 'index' ? stem.split('.').filter(Boolean) : [];
  }
  const analysisPath = segments.length ? segments.join('.') : '$';
  if (index.analysisByPath.has(analysisPath)) return analysisPath;
  // This matches active-page fallback for a custom project index filename,
  // while still refusing to map arbitrary non-index appendices onto root.
  return explicit === undefined && rootPage && index.analysisByPath.has('$')
    ? '$'
    : undefined;
}

/**
 * Canonical analysis path → site-relative href for unambiguous configured
 * pages. Missing pages, pattern-expanded TOCs, invalid scopes, and duplicate
 * mappings deliberately produce no href.
 */
export function analysisPageHrefs(
  root: string,
  index: AnalysisIndex,
): ReadonlyMap<string, string> {
  const config = configuredPages(root);
  if (!config) return new Map();
  // MyST expands patterns before assigning slugs. Without the expanded,
  // host-owned page list we cannot prove either route uniqueness or slug
  // collision suffixes, so publish no guessed href for a patterned TOC.
  if (tocHasPattern(config.toc)) return new Map();
  const configuredFiles = tocFiles(config.toc);
  if (configuredFiles.length === 0) return new Map();

  // MyST reserves `index` for the first TOC file before slugging remaining
  // pages, so a later file named `index.*` receives its normal collision suffix.
  const seenSlugs = new Map<string, number>([['index', 1]]);
  const candidates = new Map<string, Set<string>>();
  configuredFiles.forEach((configured, position) => {
    const file = resolvePageFile(root, configured);
    if (!file) return;
    const href = position === 0
      ? '/'
      : hrefForSlug(pageSlug(root, file, config.folders, seenSlugs));
    // Slug every configured page in TOC order, including non-ASTRA pages, so
    // duplicate-name suffixes stay identical to MyST's route assignment.
    const analysisPath = pageAnalysisPath(file, index, position === 0);
    if (!analysisPath) return;
    const hrefs = candidates.get(analysisPath) ?? new Set<string>();
    hrefs.add(href);
    candidates.set(analysisPath, hrefs);
  });

  const result = new Map<string, string>();
  for (const [analysisPath, hrefs] of candidates) {
    if (hrefs.size === 1) result.set(analysisPath, [...hrefs][0]!);
  }
  return result;
}
