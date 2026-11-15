# Configuration

MySTRA needs an ASTRA 0.1 analysis in a Git repository, Node.js 20+ and Git.
The plugin bundles its TypeScript SDK and requires no Python installation.

## `myst.yml`

MyST loads the single plugin file referenced in its configuration:

```yaml title="myst.yml"
version: 1
project:
  plugins:
    - https://github.com/LightconeResearch/MySTRA/releases/latest/download/mystra.mjs
  toc:
    - file: index.md
site:
  template: book-theme
```

Use a specific release URL for reproducible publications. While reviewing the
0.1 migration, build this branch with `npm ci && npm run bundle` and point
`project.plugins` at the local `dist/mystra.mjs`. The SDK dependency is pinned to
a Git commit until its 0.2 candidate is published; `npm ci` builds that dependency
from committed schema data.

## Project root and universe

Run MyST from the folder containing the root `astra.yaml`. Authored universes
are entries of `universes` in that file. MySTRA resolves every universe together,
then selects the first root universe in authored order for page presentation.
If the root has none, a scoped analysis can use its own first universe.

Set a page default explicitly with frontmatter:

```yaml
astra_scope: stage
astra_universe: universes.alternate
```

Override it on a block with `:universe: universes.alternate`, or on a role with
`{astra:value universe=universes.alternate}`. The option is a complete SDK universe
ref, including the declaring analysis key when applicable. Unknown refs produce
an authoring diagnostic. Values and output blocks use the selected result; a
once-built result is shared across universes.

The SDK validates the complete analysis before rendering. Errors include the
source file, JSON Pointer and validation code. The plugin emits visible fallback
text rather than a partial publication payload when resolution fails.

## Result content

The SDK owns result planning and repository-relative places. MySTRA streams actual
bytes through `resultResources`, including historical commit trees and large-file
stand-ins. It tries each place until content is available, streams chunks to a
temporary file while hashing, then atomically materializes a content-hashed file
under `_build/astra-resources/` for MyST's asset pipeline. It never scans result
directories or derives result paths itself.

Resources for all resolved universes are included in publication v2. Rich themes
can switch universes with SDK selectors and the resource map, without a server
round trip. Provenance state comes from `StatusReport`; actual content can remain
available when its provenance record is missing or stale.

## Live reload

Concurrent document transforms share in-flight project work. Completed reports
are refreshed on the next document pass: Git HEAD, dirty inputs, nested analyses,
records and actual result bytes can all change independently of file metadata.
There is no completed-project cache.

MyST still needs a document rebuild to invoke the plugin. After changing ASTRA
or result files during `myst start`, re-save a Markdown page or restart the server
if that edit does not itself trigger a rebuild.

## Rendering and bibliography

Stock MyST themes render the neutral figures, tables, decisions and findings.
The ASTRA theme adds shared interactive UI using the versioned
[publication transport](theming.md). Literature citations use MyST's citation
pipeline and the project's normal bibliography configuration.
