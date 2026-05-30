import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DOIMetadata } from '../doi/resolver.js';
import type { Analysis as ASTRAAnalysis } from '@astra-spec/sdk';
import type { PaperDecisionLink, PaperInsightSummary } from '../types/papers.js';

interface CachedPaperMeta {
  doi: string;
  title: string | null;
  authors: string[];
  version: number | null;
  cache_key: string;
}

export function resolvePaperCacheDir(): string {
  const env = process.env.ASTRA_PAPER_CACHE_DIR;
  if (env) return path.resolve(env);
  return path.join(os.homedir(), '.cache', 'astra', 'papers');
}

function sanitizeDoi(doi: string, version?: number | null): string {
  let safe = doi.replace(/\//g, '_').replace(/:/g, '_');
  safe = safe.replace(/[^\w.\-]/g, '_');
  if (version != null) safe = `${safe}_v${version}`;
  return safe;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function readPaperMeta(cacheDir: string, cacheKey: string): CachedPaperMeta | null {
  const dir = path.join(cacheDir, cacheKey);
  const pdfPath = path.join(dir, 'paper.pdf');
  const metaPath = path.join(dir, 'meta.json');
  if (!existsSync(pdfPath) || !existsSync(metaPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(metaPath, 'utf-8')) as {
      doi?: string;
      title?: unknown;
      authors?: unknown;
      version?: unknown;
    };
    const authors = Array.isArray(raw.authors)
      ? raw.authors.map(cleanText).filter((author): author is string => Boolean(author))
      : [];
    return {
      doi: raw.doi ?? '',
      title: cleanText(raw.title),
      authors,
      version: typeof raw.version === 'number' ? raw.version : null,
      cache_key: cacheKey,
    };
  } catch {
    return null;
  }
}

export function findCachedPaper(cacheDir: string, doi: string): CachedPaperMeta | null {
  if (!existsSync(cacheDir)) return null;
  const base = sanitizeDoi(doi);
  const exact = readPaperMeta(cacheDir, base);
  if (exact) return exact;
  const prefix = `${base}_v`;
  let best: { version: number; meta: CachedPaperMeta } | null = null;
  for (const entry of readdirSync(cacheDir)) {
    if (!entry.startsWith(prefix)) continue;
    const match = entry.match(/_v(\d+)$/);
    if (!match) continue;
    const version = Number(match[1]);
    const meta = readPaperMeta(cacheDir, entry);
    if (!meta) continue;
    if (!best || version > best.version) best = { version, meta };
  }
  return best?.meta ?? null;
}

function decisionHref(slug: string, decisionId: string): string {
  return slug === 'index'
    ? `/decisions#decision-${decisionId}`
    : `/${slug}/decisions#decision-${decisionId}`;
}

function decisionKey(slug: string, decisionId: string): string {
  return slug === 'index' ? decisionId : `${slug}.${decisionId}`;
}

function insightKey(slug: string, insightId: string): string {
  return slug === 'index' ? insightId : `${slug}:${insightId}`;
}

function collectDecisionLinksByInsight(
  analysis: ASTRAAnalysis,
  slug = 'index',
  byInsight = new Map<string, PaperDecisionLink[]>(),
): Map<string, PaperDecisionLink[]> {
  for (const [decisionId, decision] of Object.entries(analysis.decisions ?? {})) {
    if (decision?.from) continue;
    const link: PaperDecisionLink = {
      key: decisionKey(slug, decisionId),
      id: decisionId,
      label: decision.label ?? decisionId,
      slug,
      href: decisionHref(slug, decisionId),
    };

    for (const option of Object.values(decision.options ?? {})) {
      for (const insightId of option.insights ?? []) {
        const links = byInsight.get(insightId) ?? [];
        if (!links.some((existing) => existing.key === link.key)) {
          links.push(link);
          byInsight.set(insightId, links);
        }
      }
    }
  }

  for (const [subId, sub] of Object.entries(analysis.analyses ?? {})) {
    const subSlug = slug === 'index' ? subId : `${slug}/${subId}`;
    collectDecisionLinksByInsight(sub, subSlug, byInsight);
  }

  return byInsight;
}

function collectInsightsByDoi(
  analysis: ASTRAAnalysis,
  decisionsByInsight: Map<string, PaperDecisionLink[]>,
  slug = 'index',
  byDoi = new Map<string, PaperInsightSummary[]>(),
): Map<string, PaperInsightSummary[]> {
  for (const [insightId, insight] of Object.entries(analysis.prior_insights ?? {})) {
    const evidence = insight.evidence?.[0];
    if (!evidence?.doi) continue;
    const summary: PaperInsightSummary = {
      id: insightKey(slug, insightId),
      claim: insight.claim,
      quote: evidence.quote?.exact,
      page: evidence.location?.page,
      informs: decisionsByInsight.get(insightId) ?? [],
    };
    const summaries = byDoi.get(evidence.doi) ?? [];
    summaries.push(summary);
    byDoi.set(evidence.doi, summaries);
  }

  for (const [subId, sub] of Object.entries(analysis.analyses ?? {})) {
    const subSlug = slug === 'index' ? subId : `${slug}/${subId}`;
    collectInsightsByDoi(sub, decisionsByInsight, subSlug, byDoi);
  }

  return byDoi;
}

export function buildPaperMetadata(
  metadata: Map<string, DOIMetadata>,
  analysis: ASTRAAnalysis,
  cacheDir = resolvePaperCacheDir(),
): Map<string, DOIMetadata> {
  const decisionsByInsight = collectDecisionLinksByInsight(analysis);
  const insightsByDoi = collectInsightsByDoi(analysis, decisionsByInsight);
  return new Map(
    Array.from(metadata.entries(), ([doi, meta]) => {
      const cached = findCachedPaper(cacheDir, doi);
      return [
        doi,
        {
          ...meta,
          version: cached?.version ?? undefined,
          cache_key: cached?.cache_key ?? undefined,
          pdf_url: cached ? `/papers/${encodeURIComponent(cached.cache_key)}/paper.pdf` : undefined,
          insights: insightsByDoi.get(doi) ?? [],
        },
      ];
    }),
  );
}
