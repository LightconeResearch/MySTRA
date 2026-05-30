/**
 * MySTRA — Live ASTRA document rendering via MyST.
 *
 * Library entry point for programmatic use.
 */

export { astraToMystAST, buildAllPages } from './transform/index.js';
export type { ASTRASource } from './transform/index.js';

export { loadASTRASource } from './loader/index.js';

export { createContentServer } from './server/index.js';
export type { ServerOptions, ContentServer } from './server/index.js';

export type { PageData, SiteManifest, PageContent } from './types/content-server.js';
export type {
  Analysis as ASTRAAnalysis,
  Universe as ASTRAUniverse,
  Decision as ASTRADecision,
  Insight as ASTRAInsight,
} from '@astra-spec/sdk';
