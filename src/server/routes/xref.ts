/**
 * GET /myst.xref.json — Cross-reference index.
 */

import type { Request, Response } from 'express';
import type { XRefIndex, PageData } from '../../types/content-server.js';

export function xrefHandler(getPages: () => PageData[]) {
  return (_req: Request, res: Response) => {
    const pages = getPages();

    const references = pages.flatMap((p) => p.identifiers);

    const index: XRefIndex = {
      version: '1',
      myst: '1.0.0',
      references,
    };

    res.json(index);
  };
}
