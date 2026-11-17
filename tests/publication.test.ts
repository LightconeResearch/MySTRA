/** Decoder tests for the publication contract a theme reads back. */
import { describe, expect, it } from 'vitest';
import type { ResolvedAnalysis, StatusReport } from '@astra-spec/sdk/reports';
import {
  ASTRA_PUBLICATION_SCHEMA_VERSION,
  findAstraPublication,
} from '../src/publication.js';

type Node = Record<string, any>;
type Mutable<T> = T extends readonly (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;
interface TestPublication {
  document: Mutable<ResolvedAnalysis>;
  status: Mutable<StatusReport>;
  activeAnalysis: { key: string };
  universe: string;
  resources: Record<string, { cacheToken: string }>;
}

/** A root with a cyclic sub-analysis and one figure planned in two universes. */
function makePublication(): TestPublication {
  const universes = ['default', 'alternate'];
  const document: Mutable<ResolvedAnalysis> = {
    schema_version: 'astra-tools.resolved-analysis.v1',
    spec_version: '0.1.0',
    notes: [],
    analyses: [
      {
        key: '',
        folder: '',
        label: 'Demo',
        tags: [],
        declares: { calibration: 'calibration' },
        inputs: [],
        outputs: [
          { ref: 'outputs.shear_plot', type: 'figure', format: 'png', decisions: [], tags: [] },
          { ref: 'outputs.sigma8_metric', type: 'metric', format: 'json', decisions: [], tags: [] },
        ],
        decisions: [],
        findings: [],
        prior_insights: [],
        universes: universes.map((universe) => ({
          ref: `universes.${universe}`,
          selection: {},
          tags: [],
        })),
      },
      {
        key: 'calibration',
        folder: 'calibration',
        tags: [],
        declares: { parent: '' },
        inputs: [],
        outputs: [],
        decisions: [],
        findings: [],
        prior_insights: [],
        universes: [],
      },
    ],
    results: universes.flatMap((universe) =>
      ['shear_plot', 'sigma8_metric'].map((output) => ({
        id: `${output}#${universe}`,
        output: `outputs.${output}`,
        universe: `universes.${universe}`,
        inputs: [],
        places: [],
      })),
    ),
  };
  const status: Mutable<StatusReport> = {
    schema_version: 'astra-tools.status-report.v1',
    inputs: {},
    evidence: [],
    statuses: Object.fromEntries(
      document.results.map((result) => [
        result.id,
        { state: 'missing' as const, why: [], stale_inputs: [] },
      ]),
    ),
  };
  return {
    document,
    status,
    activeAnalysis: { key: '' },
    universe: 'universes.default',
    resources: {
      'shear_plot#default': { cacheToken: 'plot-v1' },
      'shear_plot#alternate': { cacheToken: 'plot-v2' },
    },
  };
}

function publicationEnvelope(
  publication: TestPublication,
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: ASTRA_PUBLICATION_SCHEMA_VERSION,
    activeAnalysisKey: publication.activeAnalysis.key,
    universe: publication.universe,
    analysis: publication.document,
    status: publication.status,
    resources: publication.resources,
    ...overrides,
  };
}

const resultId = 'shear_plot#default';
function carrier(
  publication = makePublication(),
  overrides: Record<string, unknown> = {},
): Node {
  return {
    type: 'div',
    class: ['hidden', 'astra-publication-bundle'],
    data: { astraPublication: publicationEnvelope(publication, overrides) },
  } as Node;
}
function resourceLink(
  url: string,
  overrides: Record<string, unknown> = {},
): Node {
  return {
    type: 'link',
    static: true,
    url,
    data: { astraArtifact: { resultId, cacheToken: 'plot-v1', ...overrides } },
  } as Node;
}
function resources(...children: Node[]): Node {
  return {
    type: 'div',
    class: 'hidden astra-publication-resources',
    children,
  } as Node;
}
function nestedTree(...children: Node[]): Node {
  return {
    type: 'root',
    children: [{ type: 'section', children: [{ type: 'div', children }] }],
  } as Node;
}

describe('findAstraPublication', () => {
  it('decodes flat, cyclic analyses and rejoins adjacent rewritten resources', () => {
    const resolved = makePublication();
    const publication = findAstraPublication(
      nestedTree(
        {
          type: 'div',
          identifier: 'pre-transform-id',
          html_id: 'rendered-anchor',
        } as Node,
        carrier(resolved, { activeAnalysisKey: 'calibration' }),
        resources(resourceLink('/_build/assets/figure.png')),
        { type: 'div', identifier: 'later-anchor' } as Node,
      ),
    );
    expect(ASTRA_PUBLICATION_SCHEMA_VERSION).toBe(
      'astra-publication-bundle.v2',
    );
    expect(publication?.document).toBe(resolved.document);
    expect(publication?.status).toBe(resolved.status);
    expect(publication?.activeAnalysis.key).toBe('calibration');
    expect(
      publication?.index.elementByRef.get('outputs.shear_plot')?.collection,
    ).toBe('outputs');
    expect(publication?.artifactUrls.get(resultId)).toBe(
      '/_build/assets/figure.png',
    );
    expect(publication?.placedIdentifiers).toEqual(
      new Set(['rendered-anchor', 'later-anchor']),
    );
  });

  it('accepts the root empty key and keeps all universes in one publication', () => {
    const publication = findAstraPublication([carrier()]);
    expect(publication?.activeAnalysis.key).toBe('');
    expect(publication?.universe).toBe('universes.default');
    expect(publication?.document.results).toHaveLength(4);
  });

  it('does not consume a non-adjacent resource carrier', () => {
    const publication = findAstraPublication(
      nestedTree(
        carrier(),
        { type: 'paragraph', children: [] } as Node,
        resources(resourceLink('/figure.png')),
      ),
    );
    expect(publication).toBeDefined();
    expect(publication?.artifactUrls.size).toBe(0);
  });

  it('keeps resources for two universes of the same output distinct', () => {
    const publication = findAstraPublication([
      carrier(),
      resources(
        resourceLink('/default.png'),
        resourceLink('/alternate.png', {
          resultId: 'shear_plot#alternate',
          cacheToken: 'plot-v2',
        }),
      ),
    ]);
    expect(publication?.artifactUrls.get('shear_plot#default')).toBe(
      '/default.png',
    );
    expect(publication?.artifactUrls.get('shear_plot#alternate')).toBe(
      '/alternate.png',
    );
  });

  it.each([
    ['/assets/figure.png', '/assets/figure.png'],
    ['figure.png?rev=1', 'figure.png?rev=1'],
    [
      'https://cdn.example.org/figure.png',
      'https://cdn.example.org/figure.png',
    ],
    ['http://cdn.example.org/figure.png', 'http://cdn.example.org/figure.png'],
    ['  /assets/figure.png  ', '/assets/figure.png'],
  ])('accepts safe resource URL %j', (url, expected) => {
    expect(
      findAstraPublication([
        carrier(),
        resources(resourceLink(url)),
      ])?.artifactUrls.get(resultId),
    ).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'mailto:test@example.org',
    '//cdn.example.org/figure.png',
    '//astra-publication.invalid/figure.png',
    '///astra-publication.invalid/figure.png',
    '\\\\cdn.example.org/figure.png',
    '\\\\astra-publication.invalid\\figure.png',
    'https:/cdn.example.org/figure.png',
    '/assets/figure.png\nset-cookie:unsafe',
    '',
  ])('rejects unsafe resource URL %j', (url) => {
    expect(
      findAstraPublication([carrier(), resources(resourceLink(url))])
        ?.artifactUrls.size,
    ).toBe(0);
  });

  it('requires a static link whose result ID and byte token match the envelope', () => {
    const nonStatic = {
      ...resourceLink('/non-static.png'),
      static: false,
    } as Node;
    expect(
      findAstraPublication([
        carrier(),
        resources(
          nonStatic,
          resourceLink('/wrong.png', { resultId: 'shear_plot#unknown' }),
          resourceLink('/stale.png', { cacheToken: 'stale' }),
        ),
      ])?.artifactUrls.size,
    ).toBe(0);
  });

  it.each([
    { schemaVersion: 'astra-publication-bundle.v1' },
    { activeAnalysisKey: 'missing' },
    { universe: 'universes.missing' },
    { universe: 1 },
    { analysis: {} },
    { status: {} },
    { resources: {}, analysis: { schema_version: 'wrong' } },
    { resources: { unknown: { cacheToken: 'x' } } },
    { resources: { [resultId]: { cacheToken: '' } } },
  ])('fails neutrally for an invalid envelope: %j', (overrides) => {
    expect(
      findAstraPublication([carrier(makePublication(), overrides)]),
    ).toBeUndefined();
  });

  it.each(['analysis key', 'element ref', 'result ID'])(
    'rejects duplicate %s identities through SDK indexing',
    (collision) => {
      const publication = makePublication();
      if (collision === 'analysis key')
        publication.document.analyses[1]!.key = '';
      else if (collision === 'element ref')
        publication.document.analyses[0]!.outputs.push(
          structuredClone(publication.document.analyses[0]!.outputs[0]!),
        );
      else
        publication.document.results.push(
          structuredClone(publication.document.results[0]!),
        );
      expect(findAstraPublication([carrier(publication)])).toBeUndefined();
    },
  );

  it('continues in document order after a malformed candidate', () => {
    const publication = findAstraPublication(
      nestedTree(carrier(makePublication(), { schemaVersion: 'wrong' }), {
        type: 'section',
        children: [carrier()],
      } as Node),
    );
    expect(publication?.activeAnalysis.key).toBe('');
  });

  it('returns undefined for absent and carrier-free trees', () => {
    for (const ast of [
      undefined,
      null,
      [],
      { type: 'root', children: [] } as Node,
    ])
      expect(findAstraPublication(ast)).toBeUndefined();
  });
});
