/**
 * GET /content/*.json — Page AST + frontmatter.
 *
 * The wildcard captures the full page slug, including any `/`
 * separators that nested sub-analyses introduce (`buildAllPages`
 * builds slugs by joining the analysis path with `/`, so a
 * grandchild lives at slug `parent/child`). The Express handler
 * exposes the captured value as `req.params[0]`.
 */

import type { Request, Response } from 'express';
import type { PageContent, PageData, References } from '../../types/content-server.js';
import { sha256 } from '../../utils/hash.js';

export function contentHandler(
  getPages: () => PageData[],
  getReferences: () => References,
) {
  return (req: Request, res: Response) => {
    // `req.params[0]` is the wildcard capture from `/content/*.json`.
    // It's the full slug regardless of depth, e.g. `index`,
    // `reconstruction`, `reconstruction/step1`.
    const slug = req.params[0] ?? req.params['slug'];
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
