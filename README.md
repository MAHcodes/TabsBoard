> [!WARNING]
> **This is a vibe coded app.** I built TabsBoard for myself, got it to a state I
> liked, and decided to put it out there for everyone. It is not audited, not
> security-reviewed, and not tested by anyone but me. Use it at your own risk.
> Back up anything you care about (there's an export button) and please report
> bugs instead of assuming they are intentional.

<div align="center">

# 🗂️ TabsBoard

**A new tab page for people with too many tabs.**

Bookmarks in color-coded collections · a board of widgets you arrange yourself ·
workspaces, saved sessions, and a tab list that can actually get out of your way.

**v1.1.0** · Chrome (MV3) + Firefox (MV2) · one shared codebase

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
- 🎨 **187 themes** — every Monkeytype palette, plus a custom one.
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
theme set, plus a custom theme builder if none of them feel like yours.

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

Grab the prebuilt `TabsBoard-1.1.0-fx.xpi` from this repo, or build it, or load the
folder directly:

1. `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → pick `dist/firefox/manifest.json`

Temporary installs disappear when you close Firefox. For a permanent install you
need it signed by Mozilla — see [addons.mozilla.org](https://addons.mozilla.org).

## 🛠️ Build it yourself

`src/` is the source of truth. `dist/` is generated.

```bash
# Chrome (MV3)
rm -rf dist/chrome && mkdir -p dist/chrome
cp -r src/. dist/chrome/
rm dist/chrome/manifest.firefox.json dist/chrome/manifest.chrome.json dist/chrome/background/background.html
cp src/manifest.chrome.json dist/chrome/manifest.json

# Firefox (MV2)
rm -rf dist/firefox && mkdir -p dist/firefox
cp -r src/. dist/firefox/
rm dist/firefox/manifest.firefox.json dist/firefox/manifest.chrome.json
cp src/manifest.firefox.json dist/firefox/manifest.json

# Pack the Firefox build
cd dist/firefox && zip -r -X ../../TabsBoard-1.1.0-fx.xpi . -x '.*'
```

Bump the version in **both** manifests, not just one.

## 🗂️ Layout

```
src/
  manifest.chrome.json    MV3 manifest
  manifest.firefox.json   MV2 manifest
  background/             service worker / background page
  common/                 storage, themes, icons, search, color utils
  newtab/                 the dashboard UI
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
