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

import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface MystMathMacro {
  macro: string;
  title?: string;
  description?: string;
}

export type MystMathMacros = Record<string, MystMathMacro>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function yamlRecord(source: string): Record<string, unknown> | undefined {
  try {
    return record(parseYaml(source));
  } catch {
    return undefined;
  }
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
  if (path.endsWith('.ipynb')) return notebookFrontmatter(source);
  if (path.endsWith('.myst.json')) {
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
  for (const filename of ['myst.yml', 'myst.yaml']) {
    try {
      const config = yamlRecord(readFileSync(join(root, filename), 'utf-8'));
      const project = record(config?.project);
      if (project) return normalizeMathMacros(project.math);
    } catch {
      // MyST owns configuration diagnostics. Missing or malformed config means
      // there is no safe project macro fallback for this adapter.
    }
  }
  return {};
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
