/**
 * Disk cache for DOI metadata (CSL-JSON).
 * Stored in .mystra-cache/doi/ with DOI as filename.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export class DOICache {
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  private keyToFilename(doi: string): string {
    return doi.replace(/\//g, '_') + '.json';
  }

  private ensureDir(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  has(doi: string): boolean {
    return existsSync(join(this.cacheDir, this.keyToFilename(doi)));
  }

  get(doi: string): any | null {
    const filePath = join(this.cacheDir, this.keyToFilename(doi));
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  set(doi: string, data: any): void {
    this.ensureDir();
    const filePath = join(this.cacheDir, this.keyToFilename(doi));
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
}
