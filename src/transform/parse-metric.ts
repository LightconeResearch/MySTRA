/** Build-time decoding for scalar metric artifacts. */

import { readFileSync } from 'node:fs';

/** A supported scalar, tuple, or object metric normalized for rendering. */
export interface ParsedMetric {
  value?: number | string;
  uncertainty?: number | string;
  error?: number | string;
  unit?: string;
  units?: string;
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
      if (typeof object.uncertainty === 'number' || typeof object.uncertainty === 'string') {
        result.uncertainty = object.uncertainty;
      }
      if (typeof object.error === 'number' || typeof object.error === 'string') {
        result.error = object.error;
      }
      if (typeof object.unit === 'string') result.unit = object.unit;
      if (typeof object.units === 'string') result.units = object.units;
      if (typeof object.label === 'string') result.label = object.label;
      return result;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
