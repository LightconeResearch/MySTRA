/**
 * Build the portable, data-only publication projection consumed by ASTRA
 * themes. MySTRA owns projection and filesystem access; it never imports the
 * React viewer. The theme receives only `project-view-model.v1` metadata plus
 * resource bindings that MyST rewrites through its static-file pipeline.
 */
import {
  buildProjectViewModel,
  type ArtifactBinding,
  type ProjectViewModelV1,
} from '@astra-spec/sdk/view-model';
import { createNodeFileAccess } from '@astra-spec/sdk/view-model/node';

import { hiddenDiv, text } from './ast-helpers.js';

export const ASTRA_PUBLICATION_SCHEMA_VERSION = 'astra-publication-bundle.v1' as const;

export interface AstraPublicationBundleV1 {
  schemaVersion: typeof ASTRA_PUBLICATION_SCHEMA_VERSION;
  revision: string;
  activeScopeId: string;
  model: ProjectViewModelV1;
}

export interface AstraPublicationResourceV1 {
  id: string;
  recordId: string;
  recordPath: string;
  mediaType: string;
  byteSize: number;
  revision: string;
}

function resourceData(binding: ArtifactBinding): AstraPublicationResourceV1 {
  return {
    id: binding.id,
    recordId: binding.recordId,
    recordPath: binding.recordPath,
    mediaType: binding.mediaType,
    byteSize: binding.size,
    revision: binding.revision,
  };
}

/**
 * Emit the model carrier and one hidden static link for every materialized
 * resource. MyST copies/fingerprints nodes marked `static: true`, then rewrites
 * `url`; the theme joins that rewritten URL back to `data.astraResource.id`.
 */
export async function buildPublicationCarriers(
  projectRoot: string,
  activeScopeId: string,
  pageSlug: string,
): Promise<any[]> {
  const projected = await buildProjectViewModel(createNodeFileAccess(projectRoot));
  const scopeExists = projected.model.scopes.some((scope) => scope.id === activeScopeId);
  if (!scopeExists) {
    throw new Error(`canonical project model has no scope "${activeScopeId}"`);
  }

  const publication: AstraPublicationBundleV1 = {
    schemaVersion: ASTRA_PUBLICATION_SCHEMA_VERSION,
    revision: projected.revision,
    activeScopeId,
    model: projected.model,
  };
  const carrier: any = hiddenDiv('astra-publication-bundle');
  carrier.identifier = `astra-publication-${pageSlug.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
  carrier.data = { astraPublication: publication };

  const resources = projected.artifacts.map((binding) => ({
    type: 'link' as const,
    url: binding.path,
    static: true,
    children: [text(binding.id)],
    data: { astraResource: resourceData(binding) },
  }));
  return resources.length > 0
    ? [carrier, hiddenDiv('astra-publication-resources', resources)]
    : [carrier];
}
