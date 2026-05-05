/**
 * Orchestrates DOI resolution: collect, fetch, cache, render citations.
 */

import { DOICache } from './cache.js';
import { fetchDOI } from './fetcher.js';
import type { References, CitationData } from '../types/content-server.js';
import type { PaperInsightSummary } from '../types/papers.js';

export interface DOIMetadata {
  label: string;
  authors: string;
  authorShort: string;
  year: string;
  title: string;
  journal: string;
  doi: string;
  version?: number;
  cache_key?: string;
  pdf_url?: string;
  insights?: PaperInsightSummary[];
}

/**
 * Resolve all DOIs and build both the references object (for bibliography)
 * and a metadata map (for inline citation formatting).
 */
export async function resolveAllDOIs(
  dois: string[],
  cacheDir: string,
): Promise<{ references: References; metadata: Map<string, DOIMetadata> }> {
  const metadata = new Map<string, DOIMetadata>();
  if (dois.length === 0) return { references: {}, metadata };

  const cache = new DOICache(cacheDir);
  const uniqueDOIs = [...new Set(dois)];

  // Fetch missing DOIs with concurrency limit
  const concurrency = 5;
  const toFetch = uniqueDOIs.filter((doi) => !cache.has(doi));

  if (toFetch.length > 0) {
    console.log(`[mystra] Fetching ${toFetch.length} DOI(s)...`);
  }

  for (let i = 0; i < toFetch.length; i += concurrency) {
    const batch = toFetch.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (doi) => {
        const data = await fetchDOI(doi);
        if (data) {
          cache.set(doi, data);
        }
        return { doi, data };
      }),
    );

    for (const { doi, data } of results) {
      if (!data) {
        console.warn(`[mystra] Could not resolve DOI: ${doi}`);
      }
    }
  }

  // Build references and metadata
  const order: string[] = [];
  const data: Record<string, CitationData> = {};
  const seenLabels = new Set<string>();

  for (let i = 0; i < uniqueDOIs.length; i++) {
    const doi = uniqueDOIs[i];
    const csl = cache.get(doi);
    let label = generateLabel(csl, doi);

    // Deduplicate labels
    if (seenLabels.has(label)) {
      label = `${label}_${i}`;
    }
    seenLabels.add(label);

    const meta = extractMetadata(csl, doi, label);
    metadata.set(doi, meta);

    order.push(label);
    data[label] = {
      label,
      enumerator: String(i + 1),
      doi,
      html: formatCitationHTML(meta),
    };
  }

  return {
    references: { cite: { order, data } },
    metadata,
  };
}

/**
 * Get citation metadata from cache synchronously (for inline rendering).
 * Returns null if the DOI hasn't been resolved yet.
 */
export function getCachedMetadata(doi: string, cacheDir: string): DOIMetadata | null {
  const cache = new DOICache(cacheDir);
  const csl = cache.get(doi);
  if (!csl) return null;
  const label = generateLabel(csl, doi);
  return extractMetadata(csl, doi, label);
}

function extractMetadata(csl: any | null, doi: string, label: string): DOIMetadata {
  if (!csl) {
    return {
      label,
      authors: '',
      authorShort: '',
      year: '',
      title: '',
      journal: '',
      doi,
    };
  }

  const authorList = csl.author ?? [];

  // Handle both family/given and literal (collaboration) author formats
  function authorName(a: any): string {
    if (a.family) return `${a.family}, ${a.given?.[0] ?? ''}.`;
    if (a.literal) return a.literal;
    return '';
  }
  function authorFamily(a: any): string {
    return a.family ?? a.literal ?? 'Unknown';
  }

  const authors = authorList.map(authorName).join(', ');

  let authorShort: string;
  if (authorList.length === 0) {
    authorShort = 'Unknown';
  } else if (authorList.length === 1) {
    authorShort = authorFamily(authorList[0]);
  } else if (authorList.length === 2) {
    authorShort = `${authorFamily(authorList[0])} & ${authorFamily(authorList[1])}`;
  } else {
    authorShort = `${authorFamily(authorList[0])} et al.`;
  }

  const year = String(csl.issued?.['date-parts']?.[0]?.[0] ?? '');
  const title = csl.title ?? '';
  const journal = csl['container-title'] ?? '';

  return { label, authors, authorShort, year, title, journal, doi };
}

function generateLabel(csl: any | null, doi: string): string {
  if (!csl) {
    return doi.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '_') ?? doi;
  }
  const first = csl.author?.[0];
  const firstAuthor = first?.family ?? first?.literal ?? 'Unknown';
  const year = csl.issued?.['date-parts']?.[0]?.[0] ?? '';
  return `${firstAuthor}_${year}`.replace(/\s+/g, '_');
}

function formatCitationHTML(meta: DOIMetadata): string {
  if (!meta.authors) {
    return `<a href="https://doi.org/${meta.doi}">${meta.doi}</a>`;
  }

  let html = meta.authors;
  if (meta.year) html += ` (${meta.year}).`;
  if (meta.title) html += ` ${meta.title}.`;
  if (meta.journal) html += ` <i>${meta.journal}</i>.`;

  return html;
}
