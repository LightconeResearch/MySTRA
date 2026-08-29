/** Build-time decoding for scalar metric artifacts. */

import { readFileSync } from 'node:fs';

/**
 * A supported scalar, tuple, or object metric normalized for rendering.
 *
 * The accepted spellings of each field are collapsed here — `error` folds into
 * `uncertainty` and `units` into `unit` — so renderers never re-implement the
 * alias rule and a new spelling is a one-line change in this module.
 */
export interface ParsedMetric {
  value?: number | string;
  uncertainty?: number | string;
  unit?: string;
  label?: string;
}

/**
 * Read a JSON metric artifact. Accepted representations are a bare scalar, a
 * `[value, uncertainty]` tuple, or an object containing `value`. Unsupported
 * shapes and read/parse failures return `undefined` so callers can render a
 * neutral fallback.
 */
export function readMetric(path: string): ParsedMetric | undefined {
  if (!path.toLowerCase().endsWith('.json')) return undefined;

  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (typeof raw === 'number' || typeof raw === 'string') {
      return { value: raw };
    }
    if (Array.isArray(raw) && raw.length >= 1) {
      const [value, uncertainty] = raw;
      if (typeof value !== 'number' && typeof value !== 'string') return undefined;
      const result: ParsedMetric = { value };
      if (typeof uncertainty === 'number' || typeof uncertainty === 'string') {
        result.uncertainty = uncertainty;
      }
      return result;
    }
    if (raw && typeof raw === 'object' && 'value' in raw) {
      const value = (raw as Record<string, unknown>).value;
      if (typeof value !== 'number' && typeof value !== 'string') return undefined;

      const object = raw as Record<string, unknown>;
      const result: ParsedMetric = { value };
      const uncertainty = object.uncertainty ?? object.error;
      if (typeof uncertainty === 'number' || typeof uncertainty === 'string') {
        result.uncertainty = uncertainty;
      }
      const unit = object.unit ?? object.units;
      if (typeof unit === 'string') result.unit = unit;
      if (typeof object.label === 'string') result.label = object.label;
      return result;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
