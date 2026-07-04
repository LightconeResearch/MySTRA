/**
 * Unit tests for the unified ASTRA path grammar (src/path.ts).
 */

import { describe, it, expect } from 'vitest';
import {
  parseAstraPath,
  pathIdentifier,
  splitDisplay,
  dottedKey,
  KIND_BY_COLLECTION,
} from '../src/path.js';

describe('parseAstraPath', () => {
  it('parses a collection + id in the root analysis', () => {
    expect(parseAstraPath('outputs.hubble_diagram')).toMatchObject({
      scope: [],
      collection: 'outputs',
      id: 'hubble_diagram',
      child: null,
    });
  });

  it('parses a child (option of a decision)', () => {
    expect(parseAstraPath('decisions.algorithm.options.gp')).toMatchObject({
      collection: 'decisions',
      id: 'algorithm',
      child: { collection: 'options', id: 'gp' },
    });
  });

  it('parses a child (evidence of a finding)', () => {
    expect(parseAstraPath('findings.sig.evidence.fig1')).toMatchObject({
      collection: 'findings',
      id: 'sig',
      child: { collection: 'evidence', id: 'fig1' },
    });
  });

  it('treats a leading bare id as a sub-analysis scope step (analyses. implied)', () => {
    expect(parseAstraPath('reconstruction.outputs.xi')).toMatchObject({
      scope: ['reconstruction'],
      collection: 'outputs',
      id: 'xi',
    });
  });

  it('parses the explicit analyses.<sub>.… long form identically', () => {
    expect(parseAstraPath('analyses.reconstruction.outputs.xi')).toMatchObject({
      scope: ['reconstruction'],
      collection: 'outputs',
      id: 'xi',
    });
  });

  it('parses nested scopes', () => {
    expect(parseAstraPath('clustering.correlation.outputs.xi')).toMatchObject({
      scope: ['clustering', 'correlation'],
      collection: 'outputs',
      id: 'xi',
    });
  });

  it('parses a bare sub-analysis target (collection null)', () => {
    expect(parseAstraPath('reconstruction')).toMatchObject({
      scope: ['reconstruction'],
      collection: null,
      id: null,
    });
    expect(parseAstraPath('analyses.reconstruction')).toMatchObject({
      scope: ['reconstruction'],
      collection: null,
      id: null,
    });
  });

  it('parses a whole collection (a registry)', () => {
    expect(parseAstraPath('outputs')).toMatchObject({ collection: 'outputs', id: null });
    expect(parseAstraPath('reconstruction.inputs')).toMatchObject({
      scope: ['reconstruction'],
      collection: 'inputs',
      id: null,
    });
    expect(parseAstraPath('analyses')).toMatchObject({ collection: 'analyses', id: null });
  });

  it('tolerates a leading / (paths always resolve from the root)', () => {
    expect(parseAstraPath('/decisions.method')).toMatchObject({
      collection: 'decisions',
      id: 'method',
    });
  });

  it('accepts the prior-insights hyphen alias for prior_insights', () => {
    expect(parseAstraPath('prior-insights.recon')).toMatchObject({
      collection: 'prior_insights',
      id: 'recon',
    });
  });

  it('tolerates surrounding/duplicate dots and whitespace', () => {
    expect(parseAstraPath('  outputs..xi.  ')).toMatchObject({
      collection: 'outputs',
      id: 'xi',
    });
  });
});

describe('pathIdentifier', () => {
  it('maps collection + id to <kind>-<id>', () => {
    expect(pathIdentifier(parseAstraPath('outputs.xi'))).toBe('output-xi');
    expect(pathIdentifier(parseAstraPath('decisions.m'))).toBe('decision-m');
    expect(pathIdentifier(parseAstraPath('prior_insights.p'))).toBe('prior_insight-p');
  });

  it('collapses children to their parent element identifier', () => {
    expect(pathIdentifier(parseAstraPath('decisions.m.options.a'))).toBe('decision-m');
    expect(pathIdentifier(parseAstraPath('findings.f.evidence.e'))).toBe('finding-f');
  });

  it('returns null for registries and bare sub-analyses', () => {
    expect(pathIdentifier(parseAstraPath('outputs'))).toBeNull();
    expect(pathIdentifier(parseAstraPath('reconstruction'))).toBeNull();
  });
});

describe('splitDisplay', () => {
  it('extracts MyST-style display text <target>', () => {
    expect(splitDisplay('our method <decisions.algorithm>')).toEqual({
      display: 'our method',
      path: 'decisions.algorithm',
    });
  });

  it('returns a bare path unchanged with null display', () => {
    expect(splitDisplay('outputs.xi')).toEqual({ display: null, path: 'outputs.xi' });
  });

  it('supports %s placeholders in the display text', () => {
    expect(splitDisplay('see Fig. %s <outputs.xi>')).toEqual({
      display: 'see Fig. %s',
      path: 'outputs.xi',
    });
  });
});

describe('dottedKey + KIND_BY_COLLECTION', () => {
  it('builds the dotted store key from scope + id', () => {
    expect(dottedKey([], 'xi')).toBe('xi');
    expect(dottedKey(['reconstruction'], 'xi')).toBe('reconstruction.xi');
  });

  it('maps every collection to its singular kind', () => {
    expect(KIND_BY_COLLECTION).toMatchObject({
      outputs: 'output',
      inputs: 'input',
      decisions: 'decision',
      findings: 'finding',
      prior_insights: 'prior_insight',
      analyses: 'analysis',
      universes: 'universe',
    });
  });
});
