> [!WARNING]
> Disclaimer: This project was "vibe coded" primarily for personal use that I decided to open-source, It is provided as-is, without any warranties.
>
> **USE AT YOUR OWN RISK**

<div align="center">

# 🗂️ TabsBoard

**A new tab page for people with too many tabs.**

Bookmarks in color-coded collections · a board of widgets you arrange yourself ·
workspaces, saved sessions, and a tab list that can actually get out of your way.

**v2.0.0** · Chrome (MV3) + Firefox (MV2) · one shared codebase

</div>

---

## ✨ What it does

- 🗂️ **Collections** — group bookmarks, drop open tabs straight into one, color
  and pin them, switch a collection between a tile grid and a dense list.
- 🧩 **Widget board** — drag widgets around a real grid. Leave gaps, resize,
  span rows, swap anything with anything.
- 🗂️ **Bookmarks from your browser** — pull your existing Firefox or Chrome
  bookmarks in, and sync them to a collection whenever you want.
- 🗃️ **Workspaces & boards** — separate setups per work/personal, several boards
  inside each, one keystroke to switch.
- 💾 **Sessions** — save the current window or every window at once, restore into
  this window or a fresh one, and turn any session into a bookmark collection.
- 🪦 **Trash** — delete things with a safety net. Empty it when you're ready.
- 🧹 **Unload tabs** — strip memory-heavy tabs down to their favicon without
  losing where they were.
- 🧭 **Command palette** — `Ctrl/⌘ K` to jump to a bookmark, a tab, or any command.
- ⌨️ **Address bar** — type `tb` then anything to search your bookmarks, tabs, and
  sessions without leaving the URL bar.
- 🖱️ **Right-click menu** — add the page, a link, or a selection to TabsBoard.
- 🎨 **187 themes** — every Monkeytype palette, plus a builder for your own.
- 🌍 **Weather, RSS, downloads, history, most-visited, CPU** as widgets.
- 💾 **Yours, locally** — everything lives in browser storage. No account, no
  server, no analytics.

## 🧩 Widgets

`Collection` `Notes` `To-Do` `Clock` `Search` `Countdown` `Pomodoro` `Timer`
`Stopwatch` `Weather` `RSS` `Most visited` `Downloads` `History` `CPU`

> ⚡ The `CPU` widget needs the `system.cpu` API, which is Chrome/ChromeOS only.
> On Firefox the widget is still there — it just tells you why it can't read
> anything instead of showing a dead gauge.

## 🎨 Themes

187 presets, ported straight from [Monkeytype](https://github.com/monkeytypegame/monkeytype)'s
theme set, plus a builder for your own. The builder edits the eight colors this
app actually paints from — background, panels, text, muted text, accent, caret,
and the two error colors — and repaints the page live as you drag the pickers or
type hex values. A contrast readout tells you when the text won't survive the
background. Saved themes live beside the presets, so they show up in the grid,
in the Auto light/dark slots, and in the command palette, and they ride along
with your JSON export.

## ⌨️ Shortcuts

| Key | Action |
| --- | --- |
| `Ctrl/⌘ K` or `/` | Command palette |
| `?` | Show this list |
| `T` | Toggle sidebar |
| `⇧C` | Toggle compact sidebar |
| `C` | New collection |
| `V` | Toggle grid / list view |
| `B` / `⇧B` | Next / previous board |
| `W` / `⇧W` | Next / previous workspace |
| `S` | Settings |
| `G` | Trash (press again to close) |
| `Esc` | Close dialogs / clear selection |

Three more live in the browser's own shortcut settings (`chrome://extensions/shortcuts`,
or the Firefox add-on shortcuts page):

| Command | Default |
| --- | --- |
| Open TabsBoard | `Alt+⇧D` |
| Quick-add current tab | `Ctrl/⌘+⇧A` |
| Toggle sidebar | `Alt+⇧S` |

## 📦 Install

### 🟢 Chrome

1. Clone this repo (or download it)
2. `chrome://extensions` → turn on **Developer mode**
3. **Load unpacked** → pick `dist/chrome/`

### 🦊 Firefox

Install it from AMO:
[addons.mozilla.org/firefox/addon/tabsboard](https://addons.mozilla.org/en-US/firefox/addon/tabsboard/)
— click **Add to Firefox**. That install is signed by Mozilla, survives restarts,
and updates on its own.

Or build it yourself and load the folder directly:

1. `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → pick `dist/firefox/manifest.json`

Temporary installs disappear when you close Firefox, and Firefox won't serve an
unsigned `.xpi` as a permanent install. If you want your own build to stick
around, push it through [addons.mozilla.org](https://addons.mozilla.org) as an
unlisted add-on, or sign it yourself with
[web-ext](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/):

```bash
web-ext sign --api-key "$AMO_KEY" --api-secret "$AMO_SECRET" \
  --source-dir dist/firefox
```

## 🛠️ Build it yourself

`src/` is the source of truth. `dist/` and the packed `.xpi` are generated and
gitignored, so build before either install step. You need Node 22+.

```bash
npm install            # once: dev tooling only, nothing here ships in the extension

node scripts/build.js chrome     # Chrome (MV3)  -> dist/chrome
node scripts/build.js firefox    # Firefox (MV2) -> dist/firefox
node scripts/build.js            # both
```

Each build also checks that every file the manifest and the pages point at is
present, and leaves tests and tooling out of the package. With
[`just`](https://just.systems) installed, `just chrome`, `just firefox`,
`just build` and `just pack-firefox` (a versioned `.xpi`) do the same.

## 🧪 Development

```bash
npm run check      # version/SDK sync + ESLint + cross-file lint + unit tests (what CI runs first)
npm test           # unit tests only (node:test; storage, search, plugins, themes, migrations)
npm run lint       # ESLint, plus scripts/lint-bundle.js (see below)
npm run lint:ext   # build both targets and lint them with Mozilla's web-ext
npm run test:e2e   # browser tests; needs Playwright (below)
npm run sync       # fix version / SDK-copy drift
```

Browser tests drive the real new-tab page in Chromium:

```bash
pip install -r tests/e2e/requirements.txt && playwright install chromium
python3 tests/e2e/run_all.py              # all of them
python3 tests/e2e/run_all.py palette      # just the ones whose file name matches
```

A few things worth knowing:

- **The newtab scripts share one global scope** (they are plain `<script>`s, loaded in
  the order listed in `newtab/index.html`), so linting file by file can't tell a typo from a
  function defined elsewhere. `scripts/lint-bundle.js` concatenates them in load order and
  lints the result, which finds undefined names, unused top-level code and duplicate
  declarations, with the real file and line.
- **Versions.** The Chrome manifest is the single source of truth. Bump it there, then run
  `npm run sync` to update the Firefox manifest, `package.json` and the version above. CI
  fails if they drift. `sdk/tabsboard-widget-sdk.js` is likewise the source for the copy in
  `examples/hello-widget/`; `npm run sync` refreshes it.
- **`innerHTML` is ratcheted.** `npm run lint:ext` counts web-ext's "unsafe assignment to
  innerHTML" warnings against `scripts/lint-ext.baseline.json`. The number may go down, not
  up: build new markup with `escapeHtml` or `textContent`.

## 🗂️ Layout

```
src/
  manifest.chrome.json    MV3 manifest (also the version source of truth)
  manifest.firefox.json   MV2 manifest
  background/             service worker / background page
  common/                 storage, themes, icons, search, color utils
  newtab/                 the dashboard UI
  popup/                  toolbar popup
sdk/                      widget SDK for plugin authors
examples/                 example plugin widget
docs/                     plugin protocol and widget docs
tests/                    unit tests (node:test) and tests/e2e (Playwright)
scripts/                  build, version/SDK sync, lint tooling
dist/                     generated builds
```

Data is versioned with a single `SCHEMA_VERSION` (currently `1`). There is no
migration ladder: if the stored data doesn't match, TabsBoard starts fresh
rather than trying to repair it.

## 🙏 Acknowledgements

- **[Monkeytype](https://github.com/monkeytypegame/monkeytype)** — the whole
  color palette. Every theme here is Monkeytype's hex values, copied verbatim,
  nothing recolored. Monkeytype is GPL-3.0; hex color codes aren't copyrightable
  expression, but the credit is theirs and it's here. 🐵
- **[Lucide](https://lucide.dev)** — every icon in the app.
  ISC. ✨
- **[Open-Meteo](https://open-meteo.com)** — weather data and city search.
  CC BY 4.0, attribution appreciated. 🌤️

Everything else was written here. If you spot code that looks like it came from
somewhere else, that's a bug — please open an issue so I can credit it or rip it
out.

## ⚖️ License

MIT — see [LICENSE](LICENSE). Fork it, ship it, sell it, whatever.

## 🐛 Found a bug?

Open an issue. Include your browser, your OS, and what you did just before it
broke. Screenshots are lovely.
