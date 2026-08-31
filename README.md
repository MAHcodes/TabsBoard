# Tabs Dashboard (v2.0)

A rich, customizable new-tab dashboard: organize bookmarks into color-coded
collections, drag open tabs straight into them, keep separate workspaces,
and save/restore tab sessions. Works in Chrome (Manifest V3) and Firefox
(Manifest V2) from one shared codebase.

## What's new in v2.0

- **Fully dynamic theming** — 18 built-in presets (Light, Dark, Nord, Dracula,
  Solarized, Ocean, Sunset, Forest, and more) plus a custom theme builder.
  Every theme redefines background, surface, borders, and text together —
  not just the accent color.
- **Sessions moved to their own top-nav page** with search, save-current-window,
  and save-all-windows.
- **Collapsible sidebar** (`[` shortcut or the arrow button).
- **Settings reorganized into tabs**: Appearance / Behavior / Data — instead
  of one long scrolling page.
- **Keyboard shortcuts moved to their own popup** (no longer buried in Settings).
- **New, bigger, simpler icon set** throughout — grid/list toggle now shows
  the icon of the view you'll switch *to*.
- **Wider collection cards** and a filter box to quickly narrow down collections.
- **Deeper browser API integration**: pin/mute/duplicate open tabs, move a tab
  to a new window, open every bookmark in a collection at once (same window
  or a new one), copy all links in a collection, restore a session into the
  current window or a fresh one, save tabs across *all* open windows as one
  session.
- **More collection/bookmark actions**: pin collections to the top, duplicate
  a collection (with its bookmarks), cycle sort mode (manual / A–Z / newest /
  oldest), pin individual bookmarks, copy a bookmark's link, convert a saved
  session straight into a collection.

## What's included

- `src/` — shared source (the source of truth; edit here)
- `dist/chrome/` — ready-to-load Chrome build (MV3)
- `dist/firefox/` — ready-to-load Firefox build (MV2)

Both `dist/` folders are pre-built for you. If you edit anything in `src/`,
re-run the build (see **Rebuilding** below).

## Install — Chrome / Edge / Brave (Chromium)

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `dist/chrome` folder
5. Open a new tab — the dashboard should appear

## Install — Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select any file inside `dist/firefox` (e.g. `manifest.json`)
4. Open a new tab — the dashboard should appear

> Temporary add-ons are removed when Firefox restarts. For a permanent
> install you'd package `dist/firefox` as a signed `.xpi` via
> [web-ext](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/)
> and Mozilla's signing service — not required for local testing.

## Features

**Bookmarks & collections**
- Color-coded collections with drag-and-drop reordering, pin-to-top, duplicate, cycling sort modes
- Grid or list view, per collection; wider cards; filter box to narrow the list
- Drag items from the **Open Tabs** sidebar straight onto a collection to bookmark them
- Per-bookmark pin, copy-link, edit, delete; open every bookmark in a collection at once (current or new window); copy all links in a collection
- Bulk select (click checkboxes / shift-click), bulk move, bulk delete
- Soft-delete: everything goes to **Trash** first, restore anytime, or empty trash

**Workspaces**
- Multiple named, colored workspaces, each with fully isolated collections/bookmarks/sessions
- Switch via the workspace button top-left

**Sessions (own top-nav page)**
- Save the current window's tabs, or every tab across every open window, as a named session
- Restore into a new window or the current one; duplicate, rename, or convert a session straight into a collection

**Open Tabs sidebar**
- Collapsible (arrow button or `[`)
- Per-tab actions: pin/unpin, mute/unmute, duplicate, move to a new window, close, or drag onto a collection to bookmark it

**Command palette (⌘/Ctrl K)**
- Fuzzy-ish search across your bookmarks, open tabs, and app actions (new collection, save session, open settings, switch views, etc.)

**Quick-add**
- Toolbar popup (now theme-matched): one click adds the current tab to any collection, or create a new collection on the spot
- Keyboard shortcut `Ctrl/Cmd+Shift+A` adds the active tab to your first collection instantly
- Right-click any page or link → **Add to Tabs Dashboard** (with a per-collection submenu)

**Settings** (now split into tabs instead of one long page)
- *Appearance*: 18 built-in themes + a custom theme builder (pick background/text/accent, save, reuse), density, default view, sidebar default state
- *Behavior*: confirm-before-permanently-deleting, favicon source (Google / DuckDuckGo / none)
- *Data*: JSON export/import, bookmarks.html export

**Keyboard shortcuts** (now their own popup, not buried in Settings)
- `Ctrl/Cmd+K` — command palette
- `Ctrl/Cmd+Shift+A` — quick-add current tab
- `N` — new collection
- `[` — toggle sidebar
- `V` — toggle grid/list view
- `Esc` — close dialogs / clear selection

## Data & privacy

Everything is stored locally via `chrome.storage.local` — nothing leaves
your browser, no accounts, no servers. (Per your preference, settings are
**not** synced across devices — pure local storage.)

## Rebuilding after editing `src/`

There's no bundler dependency — it's plain HTML/CSS/JS — so "building" is
just copying `src/` into each `dist/` folder with the right manifest:

```bash
rm -rf dist && mkdir -p dist/chrome dist/firefox

cp -r src/. dist/chrome/
rm dist/chrome/manifest.firefox.json dist/chrome/manifest.chrome.json dist/chrome/background/background.html
cp src/manifest.chrome.json dist/chrome/manifest.json

cp -r src/. dist/firefox/
rm dist/firefox/manifest.firefox.json dist/firefox/manifest.chrome.json
cp src/manifest.firefox.json dist/firefox/manifest.json
```

## Notes on the "drag a tab in" feature

Browsers don't expose the real tab strip to web pages, so no extension can
literally let you drag a tab from Chrome's native tab bar into a page. What
Tabs Dashboard does instead: the **Open Tabs** sidebar lists your current
window's tabs (via the `tabs` API), and you drag *those rows* onto a
collection — same feel, without relying on something the browser doesn't allow.

## Known limitations (good next steps)

- Command palette match ranking is simple substring matching, not weighted fuzzy scoring
- No automated dead-link/duplicate checker yet
- No cloud/account sync (by design, per current settings — local only)
- Firefox's temporary add-on install resets on browser restart; packaging as a signed `.xpi` is a follow-up step if you want it permanent
