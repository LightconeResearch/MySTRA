/** End-to-end tests for the synchronous syntax / async SDK transform boundary. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VFile } from 'vfile';
import { mystParse } from 'myst-parser';

import plugin, {
  clearResolvedProjectCache,
  loadResolvedProject,
} from '../src/index.js';

const ANALYSIS = `version: "0.0.14"
name: Test analysis
inputs:
  - id: raw_catalog
    type: data
    label: Raw catalog
    description: The *raw* input catalog.
decisions:
  method:
    label: Fit method
    rationale: Why we pick this estimator.
    default: mcmc
    options:
      mcmc:
        label: MCMC sampling
        insights: [prior_result]
      grid:
        label: Grid search
  hidden_method:
    label: Hidden method
    when: [method.mcmc]
    default: only
    options:
      only:
        label: Only option
prior_insights:
  prior_result:
    label: Prior result
    claim: Earlier work established the effect.
    created_at: "2026-01-01T00:00:00Z"
    evidence:
      - id: literature
        doi: 10.1234/example.doi
        quote:
          exact: The effect is established.
outputs:
  - id: scatter_plot
    type: figure
    format: png
    label: Scatter plot
    description: Scatter of the measurements.
    inputs: [raw_catalog]
    decisions: [method]
  - id: measurements
    type: table
    format: csv
    label: Measurement table
    inputs: [raw_catalog]
  - id: summary_metric
    type: metric
    format: json
    label: Summary metric
  - id: pending_metric
    type: metric
    format: json
    label: Pending metric
  - id: hidden_metric
    type: metric
    format: json
    label: Hidden metric
    when: [method.mcmc]
findings:
  signal:
    label: Signal detected
    claim: We detect the signal at high significance.
    notes: The peak is **clear**.
    created_at: "2026-01-02T00:00:00Z"
    evidence:
      - id: plot
        artifact: scatter_plot
        quote:
          exact: A clear peak appears.
analyses:
  sub:
    name: Sub analysis
    inputs:
      - id: source
        from: ../raw_catalog
    decisions:
      local_method:
        label: Local method
        default: alpha
        options:
          alpha:
            label: Alpha
            insights: [../prior_result]
          beta:
            label: Beta
    outputs:
      - id: sub_table
        type: table
        format: csv
        label: Sub table
        inputs: [source]
        decisions: [local_method]
  unmapped:
    name: Unmapped analysis
    inputs: []
    outputs: []
`;

const UNIVERSE = `id: baseline
decisions:
  method: grid
analyses:
  sub:
    decisions:
      local_method: beta
`;

const CSV = `tracer,value,value_std
lrg,19.88,0.17
elg,0.0696,0.002
`;

type Node = Record<string, any>;

let root: string;
const originalCwd = process.cwd();

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'mystra-plugin-'));
  writeFileSync(join(root, 'astra.yaml'), ANALYSIS);
  mkdirSync(join(root, 'universes'));
  writeFileSync(join(root, 'universes', 'baseline.yaml'), UNIVERSE);
  mkdirSync(join(root, 'results', 'baseline'), { recursive: true });
  writeFileSync(join(root, 'results', 'baseline', 'scatter_plot.png'), 'PNG');
  writeFileSync(join(root, 'results', 'baseline', 'measurements.csv'), CSV);
  writeFileSync(
    join(root, 'results', 'baseline', 'summary_metric.json'),
    JSON.stringify({ value: 1.5, uncertainty: 0.3, unit: 'Mpc' }),
  );
  writeFileSync(join(root, 'results', 'baseline', 'sub.sub_table.csv'), CSV);
  writeFileSync(join(root, 'index.md'), '# Root');
  writeFileSync(join(root, 'sub.md'), '# Sub');
  writeFileSync(
    join(root, 'myst.yml'),
    `version: 1
project:
  toc:
    - file: index.md
    - file: sub.md
`,
  );
  mkdirSync(join(root, 'chapters'));
  writeFileSync(join(root, 'chapters', 'results.md'), '# Results');
  process.chdir(root);
  clearResolvedProjectCache();
});

afterAll(() => {
  process.chdir(originalCwd);
  clearResolvedProjectCache();
  rmSync(root, { recursive: true, force: true });
});

function directive(arg: string, options: Record<string, unknown> = {}): Node[] {
  return plugin.directives[0]!.run({ arg, options } as any, new VFile(), {} as any);
}

function role(name: string, body: string, options: Record<string, unknown> = {}): Node[] {
  const spec = plugin.roles.find((item: any) =>
    item.name === name || item.alias?.includes(name),
  )!;
  return spec.run({ body, options } as any, new VFile());
}

async function transform(
  children: Node[],
  page = 'index.md',
): Promise<{ tree: Node; vfile: VFile }> {
  const tree: Node = { type: 'root', children };
  const vfile = new VFile({ path: join(root, page) });
  await (plugin.transforms[0] as any).plugin()(tree, vfile);
  return { tree, vfile };
}

async function renderDirective(
  arg: string,
  options: Record<string, unknown> = {},
  page?: string,
): Promise<Node[]> {
  return (await transform(directive(arg, options), page)).tree.children;
}

async function renderRole(
  name: string,
  body: string,
  options: Record<string, unknown> = {},
): Promise<Node[]> {
  return (await transform(role(name, body, options))).tree.children;
}

function walk(node: Node | Node[], visit: (item: Node) => void): void {
  for (const item of Array.isArray(node) ? node : [node]) {
    if (!item || typeof item !== 'object') continue;
    visit(item);
    if (Array.isArray(item.children)) walk(item.children, visit);
  }
}

function find(node: Node | Node[], predicate: (item: Node) => boolean): Node | undefined {
  let result: Node | undefined;
  walk(node, (item) => {
    if (!result && predicate(item)) result = item;
  });
  return result;
}

function textContent(node: Node | Node[]): string {
  let value = '';
  walk(node, (item) => {
    if (item.type === 'text') value += item.value ?? '';
  });
  return value;
}

describe('syntax boundary', () => {
  it('keeps directive and data-backed role handlers synchronous', () => {
    expect(directive('outputs.scatter_plot')[0]?.data?.astraRequest).toMatchObject({
      surface: 'directive',
      path: 'outputs.scatter_plot',
    });
    expect(role('astra', 'outputs.scatter_plot')[0]?.data?.astraRequest).toMatchObject({
      surface: 'role',
      role: 'astra',
    });
  });

  it('preserves MyST inline role options through async resolution', async () => {
    const tree = mystParse(
      '{astra:value col=value where="tracer=lrg" pm=true}`outputs.measurements`',
      { roles: plugin.roles as any },
    ) as Node;
    const vfile = new VFile({ path: join(root, 'index.md') });
    await (plugin.transforms[0] as any).plugin()(tree, vfile);
    expect(textContent(tree)).toContain('19.88 ± 0.17');
  });

  it('resolves directive placeholders emitted by the real MyST parser', async () => {
    const tree = mystParse(':::{astra} outputs.scatter_plot\n:::', {
      directives: plugin.directives as any,
    }) as Node;
    const vfile = new VFile({ path: join(root, 'index.md') });
    await (plugin.transforms[0] as any).plugin()(tree, vfile);
    expect(find(tree, (node) => node.identifier === 'output-scatter_plot')).toBeDefined();
  });
});

describe('neutral block rendering from the resolved SDK model', () => {
  it('renders the universe-selected decision option first', async () => {
    const nodes = await renderDirective('decisions.method');
    expect(find(nodes, (node) => node.identifier === 'decision-method')).toBeDefined();
    expect(find(nodes, (node) => node.type === 'tabItem')?.title).toContain('Grid search');
  });

  it('renders figures, tables, metrics, and pending outputs', async () => {
    const figure = await renderDirective('outputs.scatter_plot');
    expect(find(figure, (node) => node.type === 'image')?.url).toBe(
      'results/baseline/scatter_plot.png',
    );
    expect(find(await renderDirective('outputs.measurements'), (node) => node.type === 'table')).toBeDefined();
    expect(textContent(await renderDirective('outputs.summary_metric'))).toContain('1.5 ± 0.3 Mpc');
    expect(textContent(await renderDirective('outputs.pending_metric'))).toContain(
      'has not been produced yet',
    );
  });

  it('does not present SDK-inactive decisions or outputs as pending records', async () => {
    expect(textContent(await renderDirective('outputs'))).not.toContain('Hidden metric');
    expect(textContent(await renderDirective('outputs.hidden_metric'))).toContain(
      'inactive under universe',
    );
    expect(textContent(await renderDirective('decisions.hidden_method'))).toContain(
      'inactive under universe',
    );
    const [value] = await renderRole('astra:value', 'outputs.hidden_metric');
    expect(value).toMatchObject({ type: 'inlineCode' });
    expect(value.value).toContain('inactive under universe');
  });

  it('renders findings and individual option/evidence children', async () => {
    const finding = await renderDirective('findings.signal');
    expect(find(finding, (node) => node.identifier === 'finding-signal')).toBeDefined();
    expect(find(finding, (node) => node.type === 'image')).toBeDefined();
    expect(textContent(await renderDirective('decisions.method.grid'))).toContain('Grid search');
    expect(textContent(await renderDirective('findings.signal.plot'))).toContain('scatter_plot');
  });

  it('resolves nested analysis paths and registries', async () => {
    const sub = await renderDirective('sub.outputs.sub_table');
    expect(find(sub, (node) => node.identifier === 'output-sub_table')).toBeDefined();
    expect(find(await renderDirective('outputs'), (node) => node.class === 'astra-outputs')).toBeDefined();
    expect(find(await renderDirective('sub'), (node) => node.identifier === 'analysis-sub')).toBeDefined();
  });

  it('stamps placed carriers with SDK identity independently of document labels', async () => {
    const output = await renderDirective('sub.outputs.sub_table', {
      label: 'published-results-table',
    });
    expect(find(output, (node) => node.identifier === 'published-results-table')?.data?.astra)
      .toEqual({
        kind: 'output',
        id: 'sub_table',
        canonicalPath: 'sub.outputs.sub_table',
      });

    const decision = await renderDirective('decisions.method');
    expect(find(decision, (node) => node.class?.includes('astra-decision'))?.data?.astra)
      .toEqual({
        kind: 'decision',
        id: 'method',
        canonicalPath: 'decisions.method',
      });

    const analysis = await renderDirective('sub', { label: 'supporting-stage' });
    const analysisCarrier = find(analysis, (node) => node.identifier === 'supporting-stage')!;
    expect(analysisCarrier.data.astra).toEqual({
      kind: 'analysis',
      id: 'sub',
      analysisPath: 'sub',
    });
    expect(analysisCarrier.data.astra).not.toHaveProperty('canonicalPath');
  });

  it('stamps child embeds and registry rows with their resolvable owner identity', async () => {
    const option = await renderDirective('decisions.method.grid');
    expect(find(option, (node) => node.class?.includes('astra-option'))?.data?.astra)
      .toEqual({
        kind: 'option',
        id: 'grid',
        canonicalPath: 'decisions.method',
      });

    const evidence = await renderDirective('findings.signal.plot');
    expect(evidence[0]?.data?.astra).toEqual({
      kind: 'evidence',
      id: 'plot',
      canonicalPath: 'findings.signal',
    });

    const outputs = await renderDirective('outputs');
    const outputRow = find(outputs, (node) =>
      node.data?.astra?.canonicalPath === 'outputs.scatter_plot');
    expect(outputRow?.data.astra).toEqual({
      kind: 'output',
      id: 'scatter_plot',
      canonicalPath: 'outputs.scatter_plot',
    });
  });
});

describe('inline roles', () => {
  it('attaches SDK canonical paths for rich-theme lookup', async () => {
    const rootRef = (await renderRole('astra', 'outputs.scatter_plot'))[0]!;
    expect(rootRef.data.astra).toMatchObject({
      kind: 'output',
      canonicalPath: 'outputs.scatter_plot',
    });
    expect(rootRef.data.astra).not.toHaveProperty('path');
    expect(rootRef.data.astra).not.toHaveProperty('analysisPath');
    expect(rootRef.data.astra).not.toHaveProperty('href');
    const nestedRef = (await renderRole('astra', 'sub.outputs.sub_table'))[0]!;
    expect(nestedRef.data.astra.canonicalPath).toBe('sub.outputs.sub_table');
  });

  it('keeps analysis navigation separate and links only a configured page mapping', async () => {
    const mapped = (await renderRole('astra', 'sub'))[0]!;
    expect(mapped.data.astra).toEqual({
      kind: 'analysis',
      id: 'sub',
      analysisPath: 'sub',
      href: '/sub',
    });
    expect(mapped.data.astra).not.toHaveProperty('canonicalPath');

    const unmapped = (await renderRole('astra', 'unmapped'))[0]!;
    expect(unmapped.data.astra).toEqual({
      kind: 'analysis',
      id: 'unmapped',
      analysisPath: 'unmapped',
    });
    expect(unmapped.data.astra).not.toHaveProperty('href');
  });

  it('renders DOI-backed citation nodes', async () => {
    const [citation] = await renderRole('astra:cite:t', 'prior_insights.prior_result');
    expect(citation).toMatchObject({
      type: 'cite',
      label: '10.1234/example.doi',
      kind: 'narrative',
    });
  });

  it('interpolates decisions, metrics, and filtered table values', async () => {
    const [decision] = await renderRole('astra:value', 'decisions.method');
    expect(textContent(decision)).toContain('Grid search');
    expect(decision.data.astra).toMatchObject({
      canonicalPath: 'decisions.method',
      type: 'decision',
      selection: 'grid',
    });

    const [metric] = await renderRole('astra:value', 'outputs.summary_metric', { pm: true });
    expect(textContent(metric)).toContain('1.5 ± 0.3');
    expect(metric.data.astra).toMatchObject({
      canonicalPath: 'outputs.summary_metric',
      type: 'metric',
      unit: 'Mpc',
    });

    const [tableValue] = await renderRole('astra:value', 'outputs.measurements', {
        col: 'value',
        where: 'tracer=lrg',
        pm: true,
    });
    expect(textContent(tableValue)).toContain('19.88 ± 0.17');
    expect(tableValue.data.astra).toMatchObject({
      canonicalPath: 'outputs.measurements',
      type: 'table',
      col: 'value',
      filter: 'tracer=lrg',
    });
  });

  it('degrades an unknown record to plain text without fabricated metadata', async () => {
    const { tree, vfile } = await transform(role('astra', 'outputs.missing'));
    expect(tree.children[0]).toMatchObject({ type: 'text', value: 'missing' });
    expect(tree.children[0]).not.toHaveProperty('data');
    expect(vfile.messages.some((message) => /no output/.test(String(message)))).toBe(true);
  });
});

describe('publication contract', () => {
  it('embeds the unchanged SDK bundle with the active analysis path', async () => {
    const project = await loadResolvedProject(root);
    const { tree } = await transform([], 'sub.md');
    const carrier = find(tree, (node) => node.class === 'astra-publication-bundle')!;
    expect(carrier).not.toHaveProperty('identifier');
    expect(Object.keys(carrier.data.astraPublication).sort()).toEqual([
      'activeAnalysisPath',
      'bundle',
      'schemaVersion',
    ]);
    expect(carrier.data.astraPublication.bundle).toBe(project.bundle);
    expect(carrier.data.astraPublication).toMatchObject({
      schemaVersion: 'astra-publication-bundle.v1',
      activeAnalysisPath: 'sub',
      bundle: { document: { schemaVersion: 'astra-resolved-analysis.v1' } },
    });
  });

  it('uses the same active scope for every supported MyST source extension', async () => {
    for (const page of ['sub.md', 'sub.ipynb', 'sub.tex', 'sub.myst.json']) {
      const { tree } = await transform([], page);
      const carrier = find(tree, (node) =>
        node.class === 'astra-publication-bundle',
      )!;
      expect(carrier.data.astraPublication.activeAnalysisPath, page).toBe('sub');
    }
  });

  it('routes every materialized binding through MyST static links', async () => {
    const { tree } = await transform([]);
    const resources = find(tree, (node) => node.class === 'astra-publication-resources')!;
    const plot = resources.children.find(
      (node: Node) => node.data?.astraArtifact?.outputPath === 'outputs.scatter_plot',
    );
    expect(plot).toMatchObject({
      type: 'link',
      url: 'results/baseline/scatter_plot.png',
      static: true,
    });
  });

  it('makes rendered and carrier asset URLs relative to a nested source page', async () => {
    const { tree } = await transform(
      directive('outputs.scatter_plot'),
      'chapters/results.md',
    );
    expect(find(tree, (node) => node.type === 'image')?.url).toBe(
      '../results/baseline/scatter_plot.png',
    );
    const resources = find(tree, (node) =>
      node.class === 'astra-publication-resources',
    )!;
    const plot = resources.children.find(
      (node: Node) => node.data?.astraArtifact?.outputPath === 'outputs.scatter_plot',
    );
    expect(plot.url).toBe('../results/baseline/scatter_plot.png');
  });

  it('registers cited DOIs once in both MyST citation modes', async () => {
    const { tree } = await transform([]);
    const cites = find(tree, (node) => node.class === 'astra-cites')!;
    expect(cites.children[0].children.map((node: Node) => node.kind)).toEqual([
      'narrative',
      'parenthetical',
    ]);
  });

  it('falls back to the root active scope for unrelated page names', async () => {
    writeFileSync(join(root, 'appendix.md'), '# Appendix');
    const { tree } = await transform([], 'appendix.md');
    const carrier = find(tree, (node) => node.class === 'astra-publication-bundle')!;
    expect(carrier.data.astraPublication.activeAnalysisPath).toBe('$');
  });
});
