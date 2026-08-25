/**
 * Diagnostics routing for the whole plugin.
 *
 * Every MySTRA warning/error goes through MyST's per-file message channel when
 * a vfile is available, so the build output attributes it to the page, with
 * line and column. Whether `--strict` then *fails* the build is mystmd's call,
 * not ours: at 1.8.2 it does not gate on `fileError` (its own `unknown role:`
 * error doesn't fail a strict build either), so treat the channel as reporting,
 * not enforcement. Plugin surfaces (directive, roles, transform) thread their
 * vfile down through the loader and renderers so no diagnostic bypasses the
 * channel. The console fallback in this module is the single escape hatch for
 * vfile-less programmatic callers (tests, the library exports).
 */

import { fileError, fileWarn } from 'myst-common';

export function reportError(vfile: any, message: string, node?: any): void {
  if (vfile) fileError(vfile, message, { node, source: 'mystra' });
  else console.error(`[mystra] ${message}`);
}

export function reportWarn(vfile: any, message: string, node?: any): void {
  if (vfile) fileWarn(vfile, message, { node, source: 'mystra' });
  else console.warn(`[mystra] ${message}`);
}
