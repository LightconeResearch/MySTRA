// Exercise the shipped single-file plugin outside this checkout, without Python.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/mystra.mjs');
const temporary = await mkdtemp(join(tmpdir(), 'mystra-bundle-'));
const previous = { cwd: process.cwd(), path: process.env.PATH };
try {
  const root = join(temporary, 'analysis');
  await mkdir(join(root, 'results'), { recursive: true });
  await writeFile(join(root, 'astra.yaml'), `spec_version: "0.1.0"
outputs:
  fit:
    type: metric
    format: json
    recipe: {command: 'fit > {output}'}
universes:
  baseline: {}
`);
  await writeFile(join(root, 'results', 'fit.json'), '{"value":1.25}');
  await writeFile(join(root, 'index.md'), '# Bundled SDK smoke');
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=MySTRA', '-c', 'user.email=bundle@astra.invalid', 'commit', '-qm', 'fixture']]) {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  }
  const standalone = join(temporary, 'mystra.mjs');
  await copyFile(source, standalone);
  if (process.platform !== 'win32') {
    const git = previous.path.split(delimiter).map((folder) => resolve(folder, 'git')).find(existsSync);
    assert.ok(git, 'Git is available');
    const bin = join(temporary, 'bin');
    await mkdir(bin);
    await symlink(git, join(bin, 'git'));
    process.env.PATH = bin;
  }
  process.chdir(root);
  const { default: plugin, loadResolvedProject } = await import(pathToFileURL(standalone).href);
  const project = await loadResolvedProject(root);
  assert.equal(project.analysis.schema_version, 'astra-tools.resolved-analysis.v1');
  const resource = [...project.resources.values()][0];
  assert.equal(await readFile(resource.path, 'utf8'), '{"value":1.25}');
  const role = plugin.roles.find((item) => item.name === 'astra:value');
  const tree = { type: 'root', children: role.run({ body: 'outputs.fit', options: {} }) };
  const file = { path: join(root, 'index.md'), data: {}, message(message) { throw new Error(String(message)); } };
  await plugin.transforms[0].plugin()(tree, file);
  assert.equal(tree.children[0].children[0].value, '1.25');
  const publication = tree.children.find((node) => node.class === 'astra-publication-bundle').data.astraPublication;
  assert.equal(publication.schemaVersion, 'astra-publication-bundle.v2');
  assert.equal(publication.activeAnalysisKey, '');
  assert.equal(publication.universe, 'universes.baseline');
  assert.equal(Object.keys(publication.resources).length, 1);
  console.log('Standalone plugin passed native Git-only resolution and publication smoke.');
} finally {
  process.chdir(previous.cwd);
  process.env.PATH = previous.path;
  await rm(temporary, { recursive: true, force: true });
}
