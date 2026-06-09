/**
 * Bundle the MyST plugin into a single self-contained ESM file.
 *
 * MyST does not load plugins from npm packages — it loads a single `.mjs` file
 * referenced by path or URL in `myst.yml` (see
 * https://mystmd.org/guide/plugins-distribute). So we bundle `src/index.ts` and
 * all its runtime dependencies (`@astra-spec/sdk`, `papaparse`, `myst-parser`,
 * and their transitive deps) into one file that the stock `myst` CLI can fetch
 * and import. The release workflow attaches this artifact to a GitHub Release.
 */
import { build } from 'esbuild';

const OUTFILE = 'dist/mystra.mjs';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: OUTFILE,
  // Some bundled CJS deps (e.g. `yaml`) call `require()` at runtime. esbuild's
  // ESM output stubs `require` to throw "Dynamic require not supported" unless a
  // real one is in scope, so inject Node's `createRequire`.
  banner: {
    js: [
      "import { createRequire as __astraCreateRequire } from 'node:module';",
      'const require = __astraCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});

console.log(`built ${OUTFILE}`);
