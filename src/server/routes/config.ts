/**
 * GET /config.json — Site manifest for the MyST book-theme.
 */

import type { Request, Response } from 'express';
import type { SiteManifest, ManifestProjectPage } from '../../types/content-server.js';
import type { PageData } from '../../types/content-server.js';

export function configHandler(getPages: () => PageData[], siteTitle: string) {
  return (_req: Request, res: Response) => {
    const pages = getPages();

    // Exclude the index page — the theme renders it via the project title
    const manifestPages: ManifestProjectPage[] = pages
      .filter((p) => p.slug !== 'index')
      .map((p) => ({
        title: p.title,
        slug: p.slug,
        level: p.level,
        description: p.frontmatter.description,
      }));

    const manifest: SiteManifest = {
      version: 1,
      myst: '1.0.0',
      id: 'mystra',
      title: siteTitle,
      projects: [
        {
          slug: '',
          index: 'index',
          title: siteTitle,
          pages: manifestPages,
        },
      ],
    };

    res.json(manifest);
  };
}
