/** End-to-end tests for the synchronous syntax / async SDK transform boundary. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { VFile } from 'vfile';
import { validate } from '@astra-spec/sdk/node';
import { mystParse } from 'myst-parser';
import {
  basicTransformations,
  inlineMathSimplificationTransform,
  mathTransform,
} from 'myst-transforms';

import plugin, {
  clearResolvedProjectCache,
  loadResolvedProject,
} from '../src/index.js';

const ANALYSIS = `spec_version: "0.1.0"
label: Test analysis
inputs:
  raw_catalog:
    path: data/raw.txt
    label: Raw catalog
    description: The *raw* input catalog.
decisions:
  route:
    options: {a: {}, b: {}}
  method:
    label: Fit method
    rationale: |
      (late-rationale)=
      ## Why $\\latevalue$

      :::{note}
      Body with {sub}\`2\`.
      :::
    options:
      mcmc:
        label: MCMC sampling
        insights: [prior_result]
      grid:
        label: Grid search
        description: |
          ## Grid details
  hidden_method:
    label: Unused method
    options:
      only:
        label: Only option
  foo_bar:
    label: Collision example
    options:
      only:
        label: Only option
prior_insights:
  unmaterialized:
    claim: The quoted observation remains available.
    evidence:
      - artifact: hidden_metric
        quote: {exact: This quoted observation survives missing content.}
  contextual:
    claim: The selected branch supports this insight.
    evidence: [{artifact: chosen}]
  prior_result:
    label: Prior result
    claim: Earlier work established the effect.
    evidence:
      - doi: 10.1234/example.doi
        quote:
          exact: The effect is established.
outputs:
  once_a:
    type: metric
    format: json
    label: First branch
    recipe: {command: 'metric > {output}'}
  once_b:
    type: metric
    format: json
    label: Second branch
    recipe: {command: 'metric > {output}'}
  chosen:
    switch: route
    cases: {a: once_a, b: once_b}
  scatter_plot:
    type: figure
    format: png
    label: Scatter plot
    description: Scatter of the measurements.
    inputs: [raw_catalog]
    decisions: [method]
    recipe: {command: 'plot {inputs.raw_catalog} {decisions.method} > {output}'}
  measurements:
    type: table
    format: csv
    label: Measurement table
    inputs: [raw_catalog]
    decisions: [method]
    recipe: {command: 'measure {inputs.raw_catalog} {decisions.method} > {output}'}
  summary_metric:
    type: metric
    format: json
    label: Summary metric
    decisions: [method, foo_bar]
    recipe: {command: 'metric {decisions.method} {decisions.foo_bar} > {output}'}
  pending_metric:
    type: metric
    format: json
    label: Pending metric
    decisions: [method]
    recipe: {command: 'metric {decisions.method} > {output}'}
  hidden_source:
    type: metric
    format: json
    decisions: [method]
    recipe: {command: 'metric {decisions.method} > {output}'}
  hidden_switch:
    switch: method
    cases: {mcmc: hidden_source}
  hidden_metric:
    type: metric
    format: json
    label: Hidden metric
    inputs: [hidden_switch]
    recipe: {command: 'metric {inputs.hidden_switch} > {output}'}
  collision_test:
    type: metric
    format: json
    label: Root metric
    inputs: [outputs.collision_test]
    recipe: {command: 'metric {inputs.outputs.collision_test} > {output}'}
  sub_summary:
    type: report
    format: txt
    inputs: [sub.sub_table]
    recipe: {command: 'cat {inputs.sub.sub_table} > {output}'}
findings:
  contextual:
    claim: Evidence follows the evaluation universe.
    evidence:
      - artifact: chosen
      - artifact: chosen#baseline
      - artifact: hidden_metric
  signal:
    label: Signal detected
    claim: We detect the signal at high significance.
    description: The peak is **clear**.
    evidence:
      - artifact: scatter_plot
        quote:
          exact: A clear peak appears.
analyses:
  sub: {path: sub}
  outputs: {path: collision}
  unmapped: {path: unmapped}
universes:
  baseline:
    decisions:
      method: grid
      route: a
      foo_bar: only
      sub.local_method: beta
  alternate:
    derived_from: baseline
    decisions:
      method: mcmc
      route: b
`;

const SUB_ANALYSIS = `spec_version: "0.1.0"
label: Sub analysis
prior_insights:
  prior_result:
    claim: Earlier work established the effect.
    evidence: [{doi: 10.1234/example.doi}]
analyses:
  parent: {path: ..}
inputs:
  source: {path: source.txt}
decisions:
  local_method:
    label: Local method
    options:
      alpha:
        label: Alpha
        insights: [prior_result]
      beta:
        label: Beta
outputs:
  sub_table:
    type: table
    format: csv
    label: Sub table
    inputs: [source]
    decisions: [local_method]
    recipe: {command: 'table {inputs.source} {decisions.local_method} > {output}'}
`;

const CSV = `tracer,value,value_std
lrg,19.88,0.17
elg,0.0696,0.002
`;

type Node = Record<string, any>;

let root: string;
const originalCwd = process.cwd();

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'mystra-plugin-'));
  writeFileSync(join(root, 'astra.yaml'), ANALYSIS);
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'raw.txt'), 'raw data');
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'astra.yaml'), SUB_ANALYSIS);
  writeFileSync(join(root, 'sub', 'source.txt'), 'child source');
  mkdirSync(join(root, 'collision', 'results'), {recursive: true});
  writeFileSync(join(root, 'collision', 'astra.yaml'), `spec_version: \"0.1.0\"\noutputs:\n  collision_test:\n    type: metric\n    format: json\n    recipe: {command: 'metric > {output}'}\n`);
  writeFileSync(join(root, 'collision', 'results', 'collision_test.json'), '{\"value\":99}');
  mkdirSync(join(root, 'unmapped'));
  writeFileSync(
    join(root, 'unmapped', 'astra.yaml'),
    'spec_version: \"0.1.0\"\nlabel: Unmapped analysis\n',
  );
  mkdirSync(join(root, 'results', 'baseline'), { recursive: true });
  writeFileSync(join(root, 'results', 'collision_test.json'), '{\"value\":42}');
  writeFileSync(join(root, 'results', 'once_a.json'), '{\"value\":11}');
  writeFileSync(join(root, 'results', 'once_b.json'), '{\"value\":22}');
  writeFileSync(join(root, 'results', 'baseline', 'scatter_plot.png'), 'PNG');
  writeFileSync(join(root, 'results', 'baseline', 'measurements.csv'), CSV);
  writeFileSync(
    join(root, 'results', 'baseline', 'summary_metric.json'),
    JSON.stringify({ value: 1.5, uncertainty: 0.3, unit: 'Mpc' }),
  );
  writeFileSync(join(root, 'results', 'baseline', 'sub.sub_table.csv'), CSV);
  mkdirSync(join(root, 'results', 'alternate'), { recursive: true });
  writeFileSync(
    join(root, 'results', 'alternate', 'summary_metric.json'),
    '{\"value\":2.75}',
  );
  writeFileSync(join(root, 'sub.md'), '# Sub');
  writeFileSync(
    join(root, 'base.yml'),
    `version: 1
project:
  math:
    '\\latevalue': '41'
  toc:
    - file: index.md
    - file: sub.md
`,
  );
  writeFileSync(
    join(root, 'myst.yml'),
    `version: 1
extend: base.yml
`,
  );
  writeFileSync(
    join(root, 'index.md'),
    `---
math:
  '\\latevalue': '42'
---
# Root`,
  );
  mkdirSync(join(root, 'chapters'));
  writeFileSync(join(root, 'chapters', 'results.md'), '# Results');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=MySTRA tests',
      '-c',
      'user.email=tests@astra.invalid',
      'commit',
      '-qm',
      'fixture',
    ],
    { cwd: root },
  );
  process.chdir(root);
  clearResolvedProjectCache();
  const validation = await validate(root);
  if (!validation.valid)
    throw new Error(JSON.stringify(validation.diagnostics));
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
    basicTransformations(tree, vfile, {
      parser: (content: string) => mystParse(content, { vfile }),
      firstDepth: 2,
    });
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

  it('runs the skipped MyST stages on late component prose with effective page macros', async () => {
    const tree = mystParse(
      '### Out of order\n\n## Late rationale\n\n:::{astra} decisions.method\n:::',
      {
        directives: plugin.directives as any,
      },
    ) as Node;
    const vfile = new VFile({ path: join(root, 'index.md') });

    // This is the host ordering: MyST's own passes have completed before a
    // document-stage plugin replaces the ASTRA request.
    basicTransformations(tree, vfile, {
      parser: (content: string) => mystParse(content, { vfile }),
      firstDepth: 2,
    });
    inlineMathSimplificationTransform(tree, { replaceSymbol: false });
    mathTransform(tree, vfile, {
      macros: { '\\latevalue': { macro: '42' } },
    });
    await (plugin.transforms[0] as any).plugin()(tree, vfile);

    const carrier = find(tree, (node) => node.identifier === 'decision-method')!;
    expect(find(carrier, (node) => node.type === 'mystTarget')).toBeUndefined();
    expect(find(carrier, (node) => node.type === 'mystDirective')).toBeUndefined();
    expect(find(carrier, (node) => node.type === 'mystRole')).toBeUndefined();
    expect(find(carrier, (node) => node.identifier === 'late-rationale')).toMatchObject({
      type: 'heading',
      depth: 4,
      label: 'late-rationale',
      html_id: 'late-rationale-1',
    });
    expect(find(carrier, (node) =>
      node.type === 'heading' && textContent(node) === 'Fit method',
    )).toMatchObject({ depth: 3, identifier: 'fit-method' });
    expect(find(tree, (node) =>
      node.type === 'heading' &&
      node.identifier === 'late-rationale' &&
      node.html_id === 'late-rationale',
    )).toBeDefined();
    const note = find(
      carrier,
      (node) => node.type === 'admonition' && node.kind === 'note',
    )!;
    expect(note.children[0]).toMatchObject({ type: 'admonitionTitle' });
    expect(find(note, (node) => node.type === 'subscript')).toBeDefined();
    const math = find(
      carrier,
      (node) => node.type === 'inlineMath' && node.value === '\\latevalue',
    );
    expect(math?.html).toContain('<mn>42</mn>');
    expect(math).not.toHaveProperty('error');
    expect(vfile.messages.some((message) =>
      /Undefined control sequence/.test(String(message)),
    )).toBe(false);
  });

  it('uses MyST heading normalization from a title-only nested page', async () => {
    const tree = mystParse(':::{astra} decisions.method\n:::', {
      directives: plugin.directives as any,
    }) as Node;
    const vfile = new VFile({ path: join(root, 'index.md') });

    // The removed page title leaves no host heading to scan. The request's
    // structural proxy is normalized by the actual host pass instead.
    basicTransformations(tree, vfile, {
      parser: (content: string) => mystParse(content, { vfile }),
      firstDepth: 3,
    });
    await (plugin.transforms[0] as any).plugin()(tree, vfile);

    const carrier = find(tree, (node) => node.data?.astra?.kind === 'decision')!;
    expect(find(carrier, (node) =>
      node.type === 'heading' && textContent(node) === 'Fit method',
    )?.depth).toBe(3);
    expect(find(carrier, (node) => node.identifier === 'late-rationale')?.depth).toBe(4);
    expect(find(tree, (node) => node.data?.astraHeadingMarker)).toBeUndefined();
  });

  it('normalizes mixed decision and standalone-option headings together', async () => {
    const tree = mystParse(
      ':::{astra} decisions.method\n:::\n\n:::{astra} decisions.method.grid\n:::',
      { directives: plugin.directives as any },
    ) as Node;
    const vfile = new VFile({ path: join(root, 'index.md') });
    basicTransformations(tree, vfile, {
      parser: (content: string) => mystParse(content, { vfile }),
      firstDepth: 3,
    });
    await (plugin.transforms[0] as any).plugin()(tree, vfile);

    const decision = find(tree, (node) => node.data?.astra?.kind === 'decision')!;
    const option = find(tree, (node) => node.data?.astra?.kind === 'option')!;
    const detailDepths: number[] = [];
    walk(tree, (node) => {
      if (node.identifier === 'grid-details') detailDepths.push(node.depth);
    });
    expect(find(decision, (node) => textContent(node) === 'Fit method')?.depth).toBe(3);
    expect(find(decision, (node) => node.identifier === 'grid-details')?.depth).toBe(4);
    expect(find(option, (node) => textContent(node).startsWith('Grid search'))?.depth).toBe(4);
    expect(detailDepths).toEqual([4, 5]);
  });

  it('preserves a standard MyST target on the rendered directive carrier', async () => {
    const tree = mystParse(
      '(custom-target)=\n:::{astra} decisions.method\n:::',
      { directives: plugin.directives as any },
    ) as Node;
    const vfile = new VFile({ path: join(root, 'index.md') });
    basicTransformations(tree, vfile, {
      parser: (content: string) => mystParse(content, { vfile }),
      firstDepth: 2,
    });
    await (plugin.transforms[0] as any).plugin()(tree, vfile);

    const carrier = find(tree, (node) => node.data?.astra?.kind === 'decision')!;
    expect(carrier).toMatchObject({
      identifier: 'custom-target',
      label: 'custom-target',
      html_id: 'custom-target',
    });
  });

  it('reserves DOM IDs for late identifier-only carriers', async () => {
    const tree = mystParse(
      '(decision-foo-bar)=\nHost target.\n\n:::{astra} decisions.foo_bar\n:::',
      { directives: plugin.directives as any },
    ) as Node;
    const vfile = new VFile({ path: join(root, 'index.md') });
    basicTransformations(tree, vfile, {
      parser: (content: string) => mystParse(content, { vfile }),
      firstDepth: 2,
    });
    await (plugin.transforms[0] as any).plugin()(tree, vfile);

    const host = find(tree, (node) => node.identifier === 'decision-foo-bar')!;
    const carrier = find(tree, (node) => node.identifier === 'decision-foo_bar')!;
    expect(host.html_id).toBe('decision-foo-bar');
    expect(carrier.html_id).toBe('decision-foo-bar-1');
  });

  it('reserves later authored request targets before replacing earlier requests', async () => {
    const tree = mystParse(
      ':::{astra} decisions.foo_bar\n:::\n\n(decision-foo-bar)=\n:::{astra} decisions.method\n:::',
      { directives: plugin.directives as any },
    ) as Node;
    const vfile = new VFile({ path: join(root, 'index.md') });
    basicTransformations(tree, vfile, {
      parser: (content: string) => mystParse(content, { vfile }),
      firstDepth: 2,
    });
    await (plugin.transforms[0] as any).plugin()(tree, vfile);

    const generated = find(tree, (node) => node.identifier === 'decision-foo_bar')!;
    const authored = find(tree, (node) =>
      node.data?.astra?.kind === 'decision' && node.identifier === 'decision-foo-bar',
    )!;
    expect(generated.html_id).toBe('decision-foo-bar-1');
    expect(authored.html_id).toBe('decision-foo-bar');
  });

  it('does not reserve identifiers carried by non-target link nodes', async () => {
    const linked: Node = {
      type: 'paragraph',
      children: [{
        type: 'link',
        identifier: 'decision-foo-bar',
        url: '#elsewhere',
        children: [{ type: 'text', value: 'elsewhere' }],
      }],
    };
    const { tree } = await transform([linked, ...directive('decisions.foo_bar')]);

    const carrier = find(tree, (node) => node.identifier === 'decision-foo_bar')!;
    expect(carrier.html_id).toBe('decision-foo-bar');
  });

  it('reports deferred semantic errors at the authored role position', async () => {
    const tree = mystParse(
      'Opening paragraph.\n\n{astra:value}`outputs.missing`',
      { roles: plugin.roles as any },
    ) as Node;
    const vfile = new VFile({ path: join(root, 'index.md') });
    basicTransformations(tree, vfile, {
      parser: (content: string) => mystParse(content, { vfile }),
      firstDepth: 2,
    });
    await (plugin.transforms[0] as any).plugin()(tree, vfile);

    const diagnostic = vfile.messages.find((message) => /no output/.test(String(message)))!;
    expect(diagnostic.line).toBe(3);
    expect(diagnostic.column).toBe(1);
  });

  it('reports deferred directive errors at the authored block position', async () => {
    const tree = mystParse(
      'Opening paragraph.\n\n:::{astra} outputs.missing\n:::',
      { directives: plugin.directives as any },
    ) as Node;
    const vfile = new VFile({ path: join(root, 'index.md') });
    basicTransformations(tree, vfile, {
      parser: (content: string) => mystParse(content, { vfile }),
      firstDepth: 2,
    });
    await (plugin.transforms[0] as any).plugin()(tree, vfile);

    const diagnostic = vfile.messages.find((message) => /no output/.test(String(message)))!;
    expect(diagnostic.line).toBe(3);
    expect(diagnostic.column).toBe(1);
  });

  it('falls back to project math macros when the page has no override', async () => {
    const decision = await renderDirective('decisions.method', {}, 'sub.md');
    const math = find(
      decision,
      (node) => node.type === 'inlineMath' && node.value === '\\latevalue',
    );
    expect(math?.html).toContain('<mn>41</mn>');
    expect(math).not.toHaveProperty('error');
  });
});

describe('neutral block rendering from the resolved SDK model', () => {
  it('renders the universe-selected decision option first', async () => {
    const nodes = await renderDirective('decisions.method');
    expect(
      find(nodes, (node) => node.identifier === 'decision-method'),
    ).toBeDefined();
    expect(find(nodes, (node) => node.type === 'tabItem')?.title).toContain(
      'Grid search',
    );
  });

  it('renders figures, tables, metrics, and pending outputs', async () => {
    const figure = await renderDirective('outputs.scatter_plot');
    expect(find(figure, (node) => node.type === 'image')?.url).toBe(
      `_build/astra-resources/${createHash('sha256').update('PNG').digest('hex')}.png`,
    );
    expect(
      find(
        await renderDirective('outputs.measurements'),
        (node) => node.type === 'table',
      ),
    ).toBeDefined();
    expect(
      textContent(await renderDirective('outputs.summary_metric')),
    ).toContain('1.5 ± 0.3 Mpc');
    expect(
      textContent(await renderDirective('outputs.pending_metric')),
    ).toContain('has not been produced yet');
  });

  it('renders math in late output-caption overrides', async () => {
    const figure = await renderDirective('outputs.scatter_plot', {
      caption: 'Fit residual $\\Delta x$ by sample.',
    });
    const math = find(figure, (node) => node.type === 'inlineMath');
    expect(math).toMatchObject({ type: 'inlineMath', value: '\\Delta x' });
    expect(math?.html).toContain('class="katex"');
  });

  it('distinguishes unplanned outputs from declared unused decisions', async () => {
    expect(textContent(await renderDirective('outputs'))).not.toContain(
      'Hidden metric',
    );
    expect(
      textContent(await renderDirective('outputs.hidden_metric')),
    ).toContain('inactive under universe');
    expect(find(await renderDirective('decisions.hidden_method'), (node) => node.type === 'tabItem')?.title).toContain('Only option');
    const [unusedDecision] = await renderRole(
      'astra:value',
      'decisions.hidden_method',
    );
    expect(unusedDecision.value).toContain('has no selection');
    const [value] = await renderRole('astra:value', 'outputs.hidden_metric');
    expect(value).toMatchObject({ type: 'inlineCode' });
    expect(value.value).toContain('inactive under universe');
  });

  it('renders findings and individual option/evidence children', async () => {
    const finding = await renderDirective('findings.signal');
    expect(
      find(finding, (node) => node.identifier === 'finding-signal'),
    ).toBeDefined();
    expect(find(finding, (node) => node.type === 'image')).toBeDefined();
    expect(
      textContent(await renderDirective('decisions.method.grid')),
    ).toContain('Grid search');
    expect(find(await renderDirective('findings.signal.0'), (node) => node.type === 'image')).toBeDefined();
  });

  it('selects switch evidence by evaluation universe even when targets are built once', async () => {
    const project = await loadResolvedProject(root);
    expect(project.index.resultById.get('once_a')?.universe).toBeUndefined();
    expect(project.index.resultById.get('once_b')?.universe).toBeUndefined();
    const baseline = textContent(await renderDirective('findings.contextual.0'));
    expect(baseline).toContain('11');
    expect(baseline).not.toContain('22');
    const alternate = textContent(await renderDirective('findings.contextual.0', {universe: 'universes.alternate'}));
    expect(alternate).toContain('22');
    expect(alternate).not.toContain('11');
  });

  it('preserves explicitly pinned evidence and concrete unplanned output labels', async () => {
    const pinned = textContent(await renderDirective('findings.contextual.1', {universe: 'universes.alternate'}));
    expect(pinned).toContain('11');
    expect(pinned).not.toContain('22');
    const pending = await renderDirective('findings.contextual.2');
    expect(textContent(pending)).toContain('Output "Hidden metric" has not been produced yet');
    expect(pending[0].data.astra).toMatchObject({ref: 'findings.contextual', evidenceIndex: 2});
  });

  it('preserves an artifact quote once in a prior insight without available result bytes', async () => {
    const nodes = await renderDirective('prior_insights.unmaterialized');
    const text = textContent(nodes);
    expect(text.split('This quoted observation survives missing content.')).toHaveLength(2);
    expect(find(nodes, (node) => node.type === 'blockquote')).toBeDefined();
    expect(text).toContain('Output "Hidden metric" has not been produced yet');
  });

  it('retains request universe and evidence identity on artifact citation references', async () => {
    const [reference] = await renderRole('astra:cite', 'findings.contextual.1', {universe: 'universes.alternate'});
    expect(reference.data.astra).toMatchObject({
      ref: 'findings.contextual', evidenceIndex: 1, universe: 'universes.alternate',
    });
  });

  it('uses the same contextual evidence selection for findings, prior insights and page defaults', async () => {
    const prior = textContent(await renderDirective('prior_insights.contextual', {universe: 'universes.alternate'}));
    expect(prior).toContain('22');
    expect(prior).not.toContain('11');
    writeFileSync(join(root, 'contextual.md'), '---\nastra_universe: universes.alternate\n---\n# Contextual');
    const {tree} = await transform(directive('findings.contextual.0'), 'contextual.md');
    const rendered = textContent(tree.children[0]);
    expect(rendered).toContain('22');
    expect(rendered).not.toContain('11');
  });

  it('resolves nested analysis paths and registries', async () => {
    const sub = await renderDirective('sub.outputs.sub_table');
    expect(
      find(sub, (node) => node.identifier === 'output-sub_table'),
    ).toBeDefined();
    expect(
      find(
        await renderDirective('outputs'),
        (node) => node.class === 'astra-outputs',
      ),
    ).toBeDefined();
    expect(
      find(
        await renderDirective('sub'),
        (node) => node.identifier === 'analysis-sub',
      ),
    ).toBeDefined();
  });

  it('stamps placed carriers with SDK identity independently of document labels', async () => {
    const output = await renderDirective('sub.outputs.sub_table', {
      label: 'published-results-table',
    });
    expect(
      find(output, (node) => node.identifier === 'published-results-table')
        ?.data?.astra,
    ).toEqual({
      kind: 'output',
      id: 'sub_table',
      ref: 'sub.outputs.sub_table',
      universe: 'universes.baseline',
    });

    const decision = await renderDirective('decisions.method');
    expect(
      find(decision, (node) => node.class?.includes('astra-decision'))?.data
        ?.astra,
    ).toEqual({
      kind: 'decision',
      id: 'method',
      ref: 'decisions.method',
      universe: 'universes.baseline',
    });

    const analysis = await renderDirective('sub', {
      label: 'supporting-stage',
    });
    const analysisCarrier = find(
      analysis,
      (node) => node.identifier === 'supporting-stage',
    )!;
    expect(analysisCarrier.data.astra).toEqual({
      kind: 'analysis',
      id: 'sub',
      analysisKey: 'sub',
      universe: 'universes.baseline',
    });
    expect(analysisCarrier.data.astra).not.toHaveProperty('ref');
  });

  it('stamps child embeds and registry rows with their resolvable owner identity', async () => {
    const option = await renderDirective('decisions.method.grid');
    expect(
      find(option, (node) => node.class?.includes('astra-option'))?.data?.astra,
    ).toEqual({
      kind: 'option',
      id: 'grid',
      ref: 'decisions.method',
      universe: 'universes.baseline',
    });

    const evidence = await renderDirective('findings.signal.0');
    expect(evidence[0]?.data?.astra).toEqual({
      kind: 'evidence',
      id: '0',
      evidenceIndex: 0,
      ref: 'findings.signal',
      universe: 'universes.baseline',
    });

    const outputs = await renderDirective('outputs');
    const outputRow = find(
      outputs,
      (node) => node.data?.astra?.ref === 'outputs.scatter_plot',
    );
    expect(outputRow?.data.astra).toEqual({
      kind: 'output',
      id: 'scatter_plot',
      ref: 'outputs.scatter_plot',
    });
  });
});

describe('inline roles', () => {
  it('attaches SDK canonical paths for rich-theme lookup', async () => {
    const rootRef = (await renderRole('astra', 'outputs.scatter_plot'))[0]!;
    expect(rootRef.data.astra).toMatchObject({
      kind: 'output',
      ref: 'outputs.scatter_plot',
    });
    expect(rootRef.data.astra).not.toHaveProperty('path');
    expect(rootRef.data.astra).not.toHaveProperty('analysisKey');
    expect(rootRef.data.astra).not.toHaveProperty('href');
    const nestedRef = (await renderRole('astra', 'sub.outputs.sub_table'))[0]!;
    expect(nestedRef.data.astra.ref).toBe('sub.outputs.sub_table');
  });

  it('keeps analysis navigation separate and links only a configured page mapping', async () => {
    const mapped = (await renderRole('astra', 'sub'))[0]!;
    expect(mapped.data.astra).toEqual({
      kind: 'analysis',
      id: 'sub',
      analysisKey: 'sub',
      href: '/sub',
      universe: 'universes.baseline',
    });
    expect(mapped.data.astra).not.toHaveProperty('ref');

    const unmapped = (await renderRole('astra', 'unmapped'))[0]!;
    expect(unmapped.data.astra).toEqual({
      kind: 'analysis',
      id: 'unmapped',
      analysisKey: 'unmapped',
      universe: 'universes.baseline',
    });
    expect(unmapped.data.astra).not.toHaveProperty('href');
  });

  it('follows declaration cycles and aliases to the canonical root key', async () => {
    const [reference] = await renderRole('astra', 'sub.parent');
    expect(reference.data.astra).toMatchObject({
      kind: 'analysis',
      analysisKey: '',
      href: '/',
    });
    const [output] = await renderRole(
      'astra',
      'sub.parent.outputs.summary_metric',
    );
    expect(output.data.astra.ref).toBe('outputs.summary_metric');
  });

  it('recomputes analysis routes when page mappings change in a live session', async () => {
    const mapped = (await renderRole('astra', 'sub'))[0]!;
    expect(mapped.data.astra.href).toBe('/sub');

    writeFileSync(
      join(root, 'sub.md'),
      '---\nastra_scope: unmapped\n---\n# Sub\n',
    );
    try {
      const remapped = (await renderRole('astra', 'sub'))[0]!;
      expect(remapped.data.astra).not.toHaveProperty('href');
    } finally {
      writeFileSync(join(root, 'sub.md'), '# Sub');
    }
  });

  it('selects a universe explicitly for values and block decisions', async () => {
    const [value] = await renderRole('astra:value', 'outputs.summary_metric', {
      universe: 'universes.alternate',
    });
    expect(textContent(value)).toBe('2.75');
    expect(value.data.astra.universe).toBe('universes.alternate');
    const nodes = await renderDirective('decisions.method', {
      universe: 'universes.alternate',
    });
    expect(find(nodes, (node) => node.type === 'tabItem')?.title).toContain(
      'MCMC sampling',
    );
    expect(nodes[0].data.astra.universe).toBe('universes.alternate');
  });

  it('keeps output refs distinct from opaque result IDs', async () => {
    const project = await loadResolvedProject(root);
    expect(project.index.elementByRef.get('outputs.collision_test')?.collection).toBe('outputs');
    expect(project.index.resultById.get('outputs:collision_test')?.output).toBe('outputs.outputs.collision_test');
    const [value] = await renderRole('astra:value', 'outputs.collision_test');
    expect(textContent(value)).toBe('42');
    expect(value.data.astra.ref).toBe('outputs.collision_test');
    const [childValue] = await renderRole('astra:value', 'analyses.outputs.outputs.collision_test');
    expect(textContent(childValue)).toBe('99');
    expect(childValue.data.astra.ref).toBe('outputs.outputs.collision_test');
  });

  it('renders DOI-backed citation nodes', async () => {
    const [citation] = await renderRole(
      'astra:cite:t',
      'prior_insights.prior_result',
    );
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
      ref: 'decisions.method',
      type: 'decision',
      selection: 'grid',
    });

    const [metric] = await renderRole('astra:value', 'outputs.summary_metric', {
      pm: true,
    });
    expect(textContent(metric)).toContain('1.5 ± 0.3');
    expect(metric.data.astra).toMatchObject({
      ref: 'outputs.summary_metric',
      type: 'metric',
      unit: 'Mpc',
    });

    const [tableValue] = await renderRole(
      'astra:value',
      'outputs.measurements',
      {
        col: 'value',
        where: 'tracer=lrg',
        pm: true,
      },
    );
    expect(textContent(tableValue)).toContain('19.88 ± 0.17');
    expect(tableValue.data.astra).toMatchObject({
      ref: 'outputs.measurements',
      type: 'table',
      col: 'value',
      filter: 'tracer=lrg',
    });
  });

  it('degrades an unknown record to plain text without fabricated metadata', async () => {
    const { tree, vfile } = await transform(role('astra', 'outputs.missing'));
    expect(tree.children[0]).toMatchObject({ type: 'text', value: 'missing' });
    expect(tree.children[0]).not.toHaveProperty('data');
    expect(
      vfile.messages.some((message) => /no output/.test(String(message))),
    ).toBe(true);
  });
});

describe('publication contract', () => {
  it('embeds the SDK analysis and status reports with the active analysis key', async () => {
    const project = await loadResolvedProject(root);
    const { tree } = await transform([], 'sub.md');
    const carrier = find(
      tree,
      (node) => node.class === 'astra-publication-bundle',
    )!;
    expect(carrier).not.toHaveProperty('identifier');
    expect(Object.keys(carrier.data.astraPublication).sort()).toEqual([
      'activeAnalysisKey',
      'analysis',
      'resources',
      'schemaVersion',
      'status',
      'universe',
    ]);
    expect(carrier.data.astraPublication.analysis).toEqual(project.analysis);
    expect(carrier.data.astraPublication.status).toEqual(project.status);
    expect(carrier.data.astraPublication).toMatchObject({
      schemaVersion: 'astra-publication-bundle.v2',
      activeAnalysisKey: 'sub',
      universe: 'universes.baseline',
      analysis: { schema_version: 'astra-tools.resolved-analysis.v1' },
      status: { schema_version: 'astra-tools.status-report.v1' },
    });
  });

  it('uses the same active scope for every supported MyST source extension', async () => {
    for (const page of ['sub.md', 'sub.ipynb', 'sub.tex', 'sub.myst.json']) {
      const { tree } = await transform([], page);
      const carrier = find(
        tree,
        (node) => node.class === 'astra-publication-bundle',
      )!;
      expect(carrier.data.astraPublication.activeAnalysisKey, page).toBe('sub');
    }
  });

  it('routes every materialized binding through MyST static links', async () => {
    const { tree } = await transform([]);
    const resources = find(
      tree,
      (node) => node.class === 'astra-publication-resources',
    )!;
    const plot = resources.children.find(
      (node: Node) =>
        node.data?.astraArtifact?.resultId === 'scatter_plot#baseline',
    );
    expect(plot).toMatchObject({
      type: 'link',
      url: `_build/astra-resources/${createHash('sha256').update('PNG').digest('hex')}.png`,
      static: true,
    });
  });

  it('makes rendered and carrier asset URLs relative to a nested source page', async () => {
    const { tree } = await transform(
      directive('outputs.scatter_plot'),
      'chapters/results.md',
    );
    expect(find(tree, (node) => node.type === 'image')?.url).toBe(
      `../_build/astra-resources/${createHash('sha256').update('PNG').digest('hex')}.png`,
    );
    const resources = find(
      tree,
      (node) => node.class === 'astra-publication-resources',
    )!;
    const plot = resources.children.find(
      (node: Node) =>
        node.data?.astraArtifact?.resultId === 'scatter_plot#baseline',
    );
    expect(plot.url).toBe(
      `../_build/astra-resources/${createHash('sha256').update('PNG').digest('hex')}.png`,
    );
  });

  it('publishes resources for every universe and preserves their actual byte hashes', async () => {
    const { tree } = await transform([]);
    const publication = find(
      tree,
      (node) => node.class === 'astra-publication-bundle',
    )!.data.astraPublication;
    const alternate = publication.resources['summary_metric#alternate'];
    expect(alternate.cacheToken).toBe(
      createHash('sha256').update('{"value":2.75}').digest('hex'),
    );
    expect(publication.resources['summary_metric#baseline']).toBeDefined();
    expect(publication.status.statuses['summary_metric#alternate'].state).toBe(
      'missing',
    );
  });

  it('uses the page universe for the publication context', async () => {
    writeFileSync(
      join(root, 'alternate.md'),
      '---\nastra_scope: sub\nastra_universe: universes.alternate\n---\n# Alternate',
    );
    const { tree } = await transform([], 'alternate.md');
    const publication = find(
      tree,
      (node) => node.class === 'astra-publication-bundle',
    )!.data.astraPublication;
    expect(publication.activeAnalysisKey).toBe('sub');
    expect(publication.universe).toBe('universes.alternate');
  });

  it('reports an invalid page universe and preserves a valid root publication', async () => {
    writeFileSync(join(root, 'invalid-universe.md'), '---\nastra_universe: universes.unknown\n---\n# Invalid');
    const {tree, vfile} = await transform([], 'invalid-universe.md');
    expect(vfile.messages.some((message) => String(message).includes('unknown universe'))).toBe(true);
    const publication = find(tree, (node) => node.class === 'astra-publication-bundle')!.data.astraPublication;
    expect(publication.activeAnalysisKey).toBe('');
    expect(publication.universe).toBe('universes.baseline');
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
    const carrier = find(
      tree,
      (node) => node.class === 'astra-publication-bundle',
    )!;
    expect(carrier.data.astraPublication.activeAnalysisKey).toBe('');
  });
});
