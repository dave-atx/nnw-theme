# Repository guidance

This repository is `nnw-theme`, the npm package that builds, previews, checks, and
packages NetNewsWire themes, plus the reusable GitHub workflows theme repositories call.
Theme repositories carry no tooling: authors run `npx nnw-theme@2 <command>` and their
workflows call `dave-atx/nnw-theme/.github/workflows/theme-*.yml@v2`. A change here
reaches every theme on its next run, so treat every release as a release to all of them.

## Development

Node 24 or newer. The TypeScript sources run directly (`node src/cli.ts render`), so
write only erasable syntax: no enums, namespaces, or parameter properties. Import
local modules with their `.ts` extension.

```sh
npm ci
npm run fetch-netnewswire    # once: the pinned NetNewsWire rendering files
npm run fix && npm run lint && npm run typecheck && npm test
python3 -m unittest discover -s lldb   # after changing lldb/nnwdump.py (Python 3.9, stdlib only)
```

Run the tool against a theme checkout with `node /path/to/nnw-theme/src/cli.ts check`
from inside the theme, or `npm link` and run `nnw-theme`.

Keep runtime dependencies few and pinned to exact versions: each one ships to every
theme and is supply-chain surface. `playwright-core` is pinned exactly because each
Playwright release pins one WebKit build; bump it deliberately, in its own release, and
re-check the starter and ember screenshots when you do.

## Port parity

The Python tool in `dave-atx/netnewswire-theme-template` (v1.0.3) is the spec for
behavior. Until 1.0.0, the port must match its output: rendered pages byte for byte,
validation messages, ZIP entries, and check failures. `scripts/parity/` compares them.
Change behavior only after parity, and list every intended difference in the PR.

## Security

Theme and fixture HTML/JavaScript are untrusted executable inputs. Browser checks
serve from 127.0.0.1 only, block every non-loopback request and count it as a failure,
and never pass browser flags that weaken sandboxing. Screenshots and the report are
the only outputs.

## Workflows

`.github/workflows/theme-*.yml` are the reusable workflows every theme calls at `@v2`;
their inputs are part of the semver contract. Each takes `nnw-theme-version` (default
`2`) and `tool-ref` (default `v2`, the ref whose `.github/actions/setup` it checks out,
because a reusable workflow's `./` paths resolve in the caller). To try a change end
to end, point a scratch theme's callers at a branch and pass `tool-ref: <branch>` and
`nnw-theme-version: next`. `scripts/packed/check.sh` runs a packed tarball against the
starter and ember, and both must pass. Results depend on installed fonts, so a local
Linux machine can see failures CI does not; CI is the reference. Run `actionlint` after changing workflows.

## Publishing

Only `.github/workflows/publish.yml` publishes, on a `vX.Y.Z` tag, through npm
Trusted Publishing and the `npm` environment's approval. Never publish from a
workstation, create or move tags, create releases, or otherwise mutate GitHub or npm
without the maintainer's explicit go-ahead for that action.

Versions follow semver on the CLI contract, the check rules, and the reusable
workflows' inputs. A check that can newly fail an existing theme by default, a removed
command or flag, or a changed workflow input is a major release.
