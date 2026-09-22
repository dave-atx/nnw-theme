# Parity harness

Runs the Python tool from `netnewswire-theme-template` v1.0.3 and this port on the
same inputs and reports every difference. Needs `uv` (for the Python tool), `git`, and
for `--check`, `playwright-cli` with WebKit for the Python side.

```sh
node scripts/parity/run.ts                  # clones the template and ember into .cache/parity/
node scripts/parity/run.ts --template ../netnewswire-theme-template --ember ../ember-nnw-theme
node scripts/parity/run.ts --check          # also run check on both and compare results
node scripts/parity/run.ts --only ember     # starter, broken, failing (with --check), or ember
```

Inputs, each prepared once and copied so both tools see the same files:

- **starter**: the template, initialized with the CI's fixed answers.
- **broken**: the starter with one of each validation problem, so error and warning
  messages are compared with and without `--allow-remote-media`.
- **failing** (with `--check`): the starter plus a fixture that leaves a macro, overflows,
  has a broken image, and throws, so check failures are compared message for message.
- **ember**: `dave-atx/ember-nnw-theme` with `test/*.toml` moved to `fixtures/`. The
  Python copy also gets a `pyproject.toml` and the template's `article` and
  `kitchen-sink` fixtures, which the port ships built in.

Compared: every file under `build/preview/` byte for byte, screenshots by decoded
pixels (with `--check`), each command's exit status and stderr, ZIP entry names, modes, content
hashes, and timestamps, and `build/check-report.txt`.

Intended differences are listed in `INTENDED` in `run.ts` and applied to the Python
side before comparing; each one needs a line in the PR that introduces it.

The Python check reuses one browser page for every case, so a case can inherit layout
from the one before it. When a screenshot differs, the harness shoots that case alone
with the Python tool's `screenshot` command and compares again; a match is reported as
a note, not a difference. With `--check`, the Python side runs `@playwright/cli@0.1.20`
(installed into `.cache/parity/`), which uses the same WebKit build as the pinned
`playwright-core`.
