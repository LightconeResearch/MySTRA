/**
 * Unit tests for the unified ASTRA path grammar (src/path.ts).
 */

import { describe, it, expect } from 'vitest';
import {
  parseAstraPath,
  canonicalRecordPath,
  pathIdentifier,
  splitDisplay,
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

  it('implies the child collection in the short form (options / evidence elided)', () => {
    expect(parseAstraPath('decisions.algorithm.gp')).toMatchObject({
      collection: 'decisions',
      id: 'algorithm',
      child: { collection: 'options', id: 'gp' },
    });
    expect(parseAstraPath('findings.sig.fig1')).toMatchObject({
      collection: 'findings',
      id: 'sig',
      child: { collection: 'evidence', id: 'fig1' },
    });
    expect(parseAstraPath('prior_insights.recon.e1')).toMatchObject({
      collection: 'prior_insights',
      id: 'recon',
      child: { collection: 'evidence', id: 'e1' },
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

  it('normalizes a bare sub-analysis target to the explicit analyses form', () => {
    expect(parseAstraPath('reconstruction')).toMatchObject({
      scope: [],
      collection: 'analyses',
      id: 'reconstruction',
    });
    expect(parseAstraPath('analyses.reconstruction')).toMatchObject({
      scope: [],
      collection: 'analyses',
      id: 'reconstruction',
    });
    expect(parseAstraPath('reconstruction.features')).toMatchObject({
      scope: ['reconstruction'],
      collection: 'analyses',
      id: 'features',
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

  it('rejects malformed and non-canonical paths', () => {
    expect(() => parseAstraPath('/decisions.method')).toThrow(/must not start/);
    expect(() => parseAstraPath('outputs..xi')).toThrow(/invalid ASTRA path/);
    expect(() => parseAstraPath('outputs.xi.extra')).toThrow(/unexpected segment/);
    expect(() => parseAstraPath('prior-insights.recon')).toThrow(/prior_insights/);
    expect(() => parseAstraPath('universes.baseline')).toThrow(/not addressable/);
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
    expect(pathIdentifier(parseAstraPath('decisions.m.a'))).toBe('decision-m');
  });

  it('returns null for registries and sub-analyses (separate pages)', () => {
    expect(pathIdentifier(parseAstraPath('outputs'))).toBeNull();
    expect(pathIdentifier(parseAstraPath('reconstruction'))).toBeNull();
    expect(pathIdentifier(parseAstraPath('analyses.reconstruction'))).toBeNull();
  });
});

describe('canonicalRecordPath', () => {
  it('matches SDK record paths at root and in nested analyses', () => {
    expect(canonicalRecordPath(parseAstraPath('outputs.xi'))).toBe('outputs.xi');
    expect(canonicalRecordPath(parseAstraPath('stage.outputs.plot'))).toBe(
      'stage.outputs.plot',
    );
  });

  it('collapses children to their owning record and excludes navigation targets', () => {
    expect(canonicalRecordPath(parseAstraPath('decisions.method.grid'))).toBe(
      'decisions.method',
    );
    expect(canonicalRecordPath(parseAstraPath('findings.result.evidence.plot'))).toBe(
      'findings.result',
    );
    expect(canonicalRecordPath(parseAstraPath('stage'))).toBeNull();
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

describe('KIND_BY_COLLECTION', () => {
  it('maps every collection to its singular kind', () => {
    expect(KIND_BY_COLLECTION).toMatchObject({
      outputs: 'output',
      inputs: 'input',
      decisions: 'decision',
      findings: 'finding',
      prior_insights: 'prior_insight',
      analyses: 'analysis',
    });
  });
});
