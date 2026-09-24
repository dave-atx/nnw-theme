# nnw-theme

Tools for building [NetNewsWire](https://netnewswire.com) themes. `nnw-theme` renders a
theme into a live preview gallery, checks it in WebKit on Mac, iPhone, and iPad in light
and dark, and packages it for release.

Start a theme from
[netnewswire-theme-template](https://github.com/dave-atx/netnewswire-theme-template)
(**Use this template**). The repository you get holds only the theme; the tooling runs
from npm, so it never needs updating by hand.

Not affiliated with or endorsed by Ranchero Software or the NetNewsWire project.

## Usage

Run it with `npx`, from anywhere inside the theme repository. It needs Node 24 or newer.

```sh
npx nnw-theme@1 init       # once: name the theme and choose its permanent identifier
npx nnw-theme@1 setup      # once per machine: install the WebKit build checks use
npx nnw-theme@1 preview    # live gallery that reloads on save
npx nnw-theme@1 check      # the release gate: package, render, and test every case
```

`@1` picks the newest 1.x release, so fixes arrive on their own and a breaking 2.0 never
does. Don't install it globally or add it to a theme repository. To use one exact
version, name it: `npx nnw-theme@1.4.2 check`.

| Command | What it does |
| --- | --- |
| `init` | Personalize a fresh copy of the template (run once) |
| `setup` | Install the WebKit browser that `check` and `screenshot` use (`--with-deps` on Linux CI) |
| `preview` | Serve the gallery on localhost, open it, and rebuild and reload it on save |
| `render [fixtures…]` | Write the gallery to `build/preview/` once |
| `check` | Validate and package, then render and test every case in WebKit |
| `screenshot` | Check one case and save its image; `--promote` makes it the marketplace card |
| `package` | Validate and build `dist/<Name>.nnwtheme.zip` |
| `capture` | Explain how to capture a real article from NetNewsWire as a fixture |
| `bump` | Increase the `Info.plist` `Version` before a release |
| `marketplace enable` | Add the marketplace discovery topic on GitHub |
| `guide [topic]` | Print the authoring guide: `skill`, `theme-format`, `fixtures`, `design-checklist`, `publishing` |
| `completion <shell>` | Print shell completion for `fish`, `zsh`, or `bash` |

Every command takes `--help`.

## Shell completion

`completion` prints a script that completes commands, options, and fixture names. It
also defines an `nnw-theme` command that runs `npx --yes nnw-theme@1`, so you can type
`nnw-theme check`. The wrapper is skipped when a real `nnw-theme` is already installed.

```sh
# fish
npx nnw-theme@1 completion fish > ~/.config/fish/conf.d/nnw-theme.fish
# zsh (~/.zshrc, after compinit)
source <(npx --yes nnw-theme@1 completion zsh)
# bash (~/.bashrc)
source <(npx --yes nnw-theme@1 completion bash)
```

Fish loads a file rather than running npx at every shell start. Zsh and bash users can
do the same with a file in `~/.zsh/` or `~/.local/share/bash-completion/completions/`.
Regenerate it when commands change.

## GitHub workflows

Theme repositories call this repository's reusable workflows, pinned to `@v1`:
`theme-check.yml` (the release gate on every push), `theme-pages.yml` (publishes the
checked gallery), `theme-release.yml` (manual release), and `theme-screenshot.yml`
(refreshes the marketplace image). The template carries the ten-line callers.

## Developing

See [AGENTS.md](AGENTS.md). Report problems at
https://github.com/dave-atx/nnw-theme/issues with the version line `check` prints.
