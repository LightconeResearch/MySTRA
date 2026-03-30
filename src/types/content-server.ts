/**
 * Content server response types matching the MyST book-theme's expectations.
 */

import type { Root } from 'myst-spec';

// ── Site manifest (GET /config.json) ──

export interface SiteManifest {
  version: number;
  myst: string;
  id?: string;
  title: string;
  projects: ManifestProject[];
  nav?: SiteNavItem[];
  actions?: SiteAction[];
}

export interface ManifestProject {
  slug: string;
  index: string;
  title: string;
  pages: ManifestProjectPage[];
}

export interface ManifestProjectPage {
  title: string;
  slug: string;
  level: number;
  short_title?: string;
  description?: string;
}

export interface SiteNavItem {
  title: string;
  url?: string;
  internal?: boolean;
  children?: SiteNavItem[];
}

export interface SiteAction {
  title: string;
  url: string;
  filename?: string;
  internal?: boolean;
}

// ── Page content (GET /content/:project/:slug.json) ──

export interface PageContent {
  kind: 'Article';
  sha256: string;
  slug: string;
  domain: string;
  project: string;
  mdast: Root;
  frontmatter: PageFrontmatter;
  references: References;
  dependencies: string[];
}

export interface PageFrontmatter {
  title: string;
  subtitle?: string;
  description?: string;
  authors?: { name: string }[];
  tags?: string[];
}

export interface References {
  cite?: {
    order: string[];
    data: Record<string, CitationData>;
  };
}

export interface CitationData {
  label: string;
  enumerator: string;
  doi?: string;
  html: string;
}

// ── Cross-reference index (GET /myst.xref.json) ──

export interface XRefIndex {
  version: '1';
  myst?: string;
  references: XRefEntry[];
}

export interface XRefEntry {
  identifier: string;
  kind: string;
  data: string;
  url: string;
  implicit?: boolean;
}

// ── Internal page data used during generation ──

export interface PageData {
  slug: string;
  title: string;
  level: number;
  ast: Root;
  frontmatter: PageFrontmatter;
  identifiers: XRefEntry[];
  dependencies: string[];
  dois: string[];
}
