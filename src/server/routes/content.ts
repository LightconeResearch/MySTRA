/**
 * GET /content/:project/:slug.json — Page AST + frontmatter.
 */

import type { Request, Response } from 'express';
import type { PageContent, PageData, References } from '../../types/content-server.js';
import { sha256 } from '../../utils/hash.js';

export function contentHandler(
  getPages: () => PageData[],
  getReferences: () => References,
) {
  return (req: Request, res: Response) => {
    const slug = req.params['slug'];
    const pages = getPages();
    const page = pages.find((p) => p.slug === slug);

    if (!page) {
      res.status(404).json({ error: `Page "${slug}" not found` });
      return;
    }

    const astJson = JSON.stringify(page.ast);
    const contentHash = sha256(astJson);
    const references = getReferences();

    const content: PageContent = {
      kind: 'Article',
      sha256: contentHash,
      slug: page.slug,
      domain: '',
      project: '',
      mdast: page.ast,
      frontmatter: page.frontmatter,
      references,
      dependencies: page.dependencies,
    };

    res.json(content);
  };
}
