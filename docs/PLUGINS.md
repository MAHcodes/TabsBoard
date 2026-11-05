# TabsBoard widget plugins

Third-party widgets run in **sandboxed iframes** and talk to the dashboard over a
small, permission-gated message API.

```
 dashboard (extension page)                    widget (your https:// page)
 ┌────────────────────────────┐   tb:hello    ┌──────────────────────────────┐
 │ plugins.js  ◄──────────────┼───────────────┤ <iframe sandbox="allow-scripts">
 │  validates, gates, limits  │   tb:init +   │  opaque origin, no extension │
 │  PluginProtocol dispatcher ├──► MessagePort│  APIs, no dashboard DOM      │
 └────────────────────────────┘◄──────────────►  TabsBoard SDK (RPC)         │
                                               └──────────────────────────────┘
```

## For users

*Add widget → Install plugin…* (or *Settings → Widgets → Widget plugins*, or the
command palette). Provide a manifest URL or paste the manifest JSON, review the
permissions, and tick only what you want to allow. You can change permissions
later from the widget's ⋯ menu or in Settings.

## For widget authors

1. Host a page over **https** (or `http://localhost` while developing).
2. Include `sdk/tabsboard-widget-sdk.js` and connect:

```js
const tb = await TabsBoard.connect();
tb.applyTheme();                               // adopt dashboard colours (--tb-* CSS vars)
const n = (await tb.storage.get('n')) || 0;    // needs "storage"
await tb.storage.set('n', n + 1);
```

3. Describe it in a manifest:

```json
{
  "id": "com.example.hello",
  "name": "Hello",
  "version": "1.0.0",
  "description": "optional, ≤ 200 chars",
  "author": "optional, ≤ 60 chars",
  "entry": "https://example.com/hello/index.html",
  "permissions": ["storage"],
  "defaultSpan": 1,
  "defaultRowSpan": 1
}
```

`entry` may be relative when the manifest is installed from a URL. Unknown
permissions make the manifest invalid (rather than being silently ignored).

### API (protocol v1)

| Call | Permission | Notes |
|---|---|---|
| `TabsBoard.connect()` → client | – | `tb.info`: `permissions` (what was *granted*), `theme`, `width`, `height`, `visible`, `span`, `rowSpan` |
| `tb.on('theme' \| 'resize' \| 'visibility', fn)` | – | returns an unsubscribe function |
| `tb.ui.setTitle(text)` | – | ≤ 60 chars, control/bidi characters stripped |
| `tb.ui.toast(text, type?)` | `ui.toast` | shown as "<Widget name>: text"; burst of 3, then 1 per 3 s |
| `tb.storage.get/set/remove/keys/clear` | `storage` | JSON only; ≤ 100 keys, 64 KB/value, 256 KB total |
| `tb.bookmarks.list({query?, collectionId?, limit?})`, `tb.bookmarks.collections()` | `bookmarks.read` | current workspace, http(s) URLs only, ≤ 200 results, fields: id/title/url/collection |
| `tb.tabs.open(url)` | `tabs.open` | http(s) only, **background** tab, burst of 3 then 1 per 20 s |
| `tb.call(method, params)` | – | escape hatch for newer host methods |

Errors reject with `TabsBoardError` whose `.code` is one of `permission_denied`,
`invalid_params`, `quota_exceeded`, `rate_limited`, `unknown_method`, `timeout`,
`internal`. Check `tb.info.permissions` and degrade gracefully when a
permission was declined.

There is deliberately **no** `destroy` event: when your card is removed the
browser tears the frame down immediately. Storage writes are saved by the host
shortly after each call, so save as you go.

### Develop locally

```sh
cd examples/hello-widget && npx serve -l 8787 .   # any static server works
# then install examples/hello-widget/manifest.json (entry is http://localhost:8787/…)
```

Your page must be embeddable: don't send `X-Frame-Options` or a restrictive
`frame-ancestors`. If the widget can't connect within 15 s the card shows an
error with a Retry button.

## Security model

What is enforced
- `<iframe sandbox="allow-scripts">` — **no** `allow-same-origin`, so the widget
  has an opaque origin: no access to the dashboard DOM, extension APIs,
  IndexedDB, or cookies/storage of its own site. No popups, forms, modals,
  downloads or top navigation.
- Entry URLs: `https://` only (plus `http://localhost|127.0.0.1|[::1]`), no
  credentials, never `chrome-extension:`/`moz-extension:`/`data:`/`blob:`/`file:`.
  The manifests also add `frame-src https: http://localhost:* http://127.0.0.1:*`
  to the extension-page CSP as defence in depth.
- Handshake: the only `window.postMessage` traffic is `tb:hello`, accepted only
  from that card's own `contentWindow` with origin `"null"`. Everything else runs
  over a private `MessageChannel` port, so widgets can't see or spoof each other.
- Every request is validated as plain JSON, size-capped, permission-checked,
  and rate-limited (global bucket + per-method buckets). A widget that keeps
  hitting limits is suspended with a Reload button. Handlers live in a `Map`, so
  names like `__proto__` can't resolve to inherited properties; storage keys
  `__proto__`/`constructor`/`prototype` are rejected.
- Permissions are chosen per permission by the user. Stored plugin records are
  re-validated on every read, so a tampered entry URL or a grant the manifest
  never requested is ignored.
- **Backups are untrusted.** Importing a backup in *replace* mode keeps plugin
  records but marks them *needs review*; they don't run until you re-approve.

What is **not** enforced — be honest with users about it
- **Network:** a sandboxed widget can still make its own requests. A widget with
  `bookmarks.read` can send what it read to its own server. The permission
  prompt says so.
- **No code pinning:** the widget's code is fetched from its URL each time, so
  the author can change it after you approve it. Approval is trust in the
  publisher, not in a specific version.
- **CPU/memory:** iframes can't be capped from the host. Browsers typically
  process-isolate cross-origin frames, but a busy widget can still slow the
  page. Use the card's ⋯ → Delete or Settings → Remove.
- **Reordering reloads frames:** moving a card in the DOM reloads its iframe
  (it re-handshakes and re-reads its storage).
- **Storage is per widget instance** and last-write-wins if two dashboard tabs
  are open.

## Tests

```sh
npm i -D dexie fake-indexeddb jsdom
node tests/plugin-protocol.test.js   # protocol, validation, limits, SDK↔dispatcher over a real MessageChannel
node tests/plugins-storage.test.js   # registry, grants, import safety
node tests/plugins-host.test.js      # real plugins.js in jsdom: handshake, lifecycle, XSS, suspension
```

The host test uses jsdom, which has **no real iframe sandbox**; it verifies
wiring and attributes (`sandbox="allow-scripts"`, no `allow-same-origin`), not
the browser's enforcement of them.
