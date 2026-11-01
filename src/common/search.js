/* Shared pure helpers: fuzzy string matching for the command palette and
   safe HTML escaping. No chrome/DOM dependencies, so a single copy of this
   logic can be unit-tested in node and reused by any page. Load it before
   the file that uses `SearchUtils` (script order in index.html handles this).
   Exposes `self.SearchUtils` in the browser and `module.exports` in node. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SearchUtils = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* Fuzzy matcher for the command palette: query characters must appear in
     order in the target (not necessarily adjacent), so "gcal" matches "Google
     Calendar" and skipped letters still find things. Returns null when the
     query isn't a subsequence, or { score, indices } — indices are the matched
     character positions so the palette can highlight them. Ranking rewards:
     matches at word boundaries (start of string, after spaces/-_/. etc.),
     camelCase humps (S -> SearchBox), consecutive runs, exact-case alignment,
     and a query that is a prefix/full match of the target; each skipped
     character in the middle of a match and a long lead-in cost points. */
  function fuzzyMatch(query, text) {
    const qRaw = String(query || '');
    const q = qRaw.toLowerCase();
    const tRaw = String(text || '');
    const t = tRaw.toLowerCase();
    if (!q) return { score: 0, indices: [] };
    if (q.length > t.length) return null;
    let qi = 0, score = 0, lastMatch = -1;
    const indices = [];
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] !== q[qi]) continue;
      const gap = ti - lastMatch - 1;
      if (lastMatch >= 0) score -= Math.min(gap, 8);       // gap between matches
      else if (ti > 0) score -= Math.min(ti, 12) * 0.5;    // long lead-in costs a bit
      if (ti === 0) score += 9;
      else if (isCharBoundary(t, ti)) score += 7;
      else if (isCamelHump(tRaw, ti)) score += 5;
      else score += 1;
      if (tRaw[ti] === qRaw[qi]) score += 2;               // exact-case alignment
      if (ti === lastMatch + 1) score += 4;                // consecutive continues
      lastMatch = ti; indices.push(ti); qi++;
    }
    if (qi < q.length) return null;
    if (t === q) score += 14;                              // exact match
    else if (t.startsWith(q)) score += 8;                  // prefix match
    else if (indices[0] === 0) score += 2;
    return { score, indices };
  }

  function isCharBoundary(t, i) {
    return i > 0 && /[\s\-_/.:,()\[\]{}&+@'"]/.test(t[i - 1]);
  }

  function isCamelHump(s, i) {
    const prev = s[i - 1], cur = s[i];
    return !!prev && prev !== prev.toUpperCase() && cur === cur.toUpperCase() && prev !== cur;
  }

  /* Wrap the fuzzy-matched characters of a label in a <mark> so the palette
     shows *why* a row matched. Works on the raw string, escaping each segment
     so untrusted bookmark/session text can't inject markup. Consecutive
     matches render as one continuous pill: only the outer <mark>s keep
     rounded corners (hl-start / hl-mid / hl-end classes), so "Melissa"
     reads as a single highlight instead of beaded letters. */
  function highlightLabel(label, indices) {
    if (!indices || !indices.length) return escapeHtml(label);
    let out = '', last = 0, prev = -2;
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      const prevConsec = i === prev + 1;
      const nextConsec = indices[k + 1] === i + 1;
      let cls = '';
      if (prevConsec && nextConsec) cls = 'hl-mid';
      else if (prevConsec) cls = 'hl-end';
      else if (nextConsec) cls = 'hl-start';
      const attrs = cls ? ` class="${cls}"` : '';
      out += escapeHtml(label.slice(last, i)) + `<mark${attrs}>` + escapeHtml(label[i]) + '</mark>';
      last = i + 1;
      prev = i;
    }
    return out + escapeHtml(label.slice(last));
  }

  /* ---------- Command-tree helpers (used by the palette) ----------
     The palette is a tree of items: leaves ({ label, ... }) and folders
     ({ children: [] | () => [] }). These pure helpers flatten that tree for
     "type anywhere to find anything", rank the flattened leaves, and cap/group
     the ranked list into sections so the UI can render headings. */
  function childrenOf(item) {
    const c = item && item.children;
    return typeof c === 'function' ? (c() || []) : (Array.isArray(c) ? c : []);
  }

  /* Depth-first flatten. Every item gets `path` (labels of the folders above
     it), `chain` (those folder items themselves, so the UI can navigate
     "into" a folder found by search) and `searchLabel` (what gets matched/shown in search results).
     Options of a "setting" folder (item.settingId) are labelled
     "Density: Compact" so they are findable by either word, and their path
     skips the setting folder itself to avoid saying "Density" twice. */
  function flattenTree(items, trail, parent, out, chain) {
    trail = trail || []; out = out || []; chain = chain || [];
    for (const it of (items || [])) {
      const isFolder = !!it.children || it.kind === 'folder';
      let searchLabel = it.label, path = trail;
      if (!isFolder && parent && parent.settingId) {
        searchLabel = parent.label + ': ' + it.label;
        path = trail.slice(0, -1);
      }
      out.push(Object.assign({}, it, { searchLabel, path, chain }));
      if (isFolder) flattenTree(childrenOf(it), trail.concat(it.label), it, out, chain.concat(it));
    }
    return out;
  }

  /* A fuzzy match is only *useful* in a big command list if it looks
     intentional. Accept when the query is a contiguous piece of the label
     ("bar" → "Sidebar"), or when it starts at the label / a word / a camel
     hump AND lands the rest of its letters on word starts or in runs, with at
     most ONE jump into the middle of a word ("cmp" → "Compact", "gcal" →
     "Google Calendar", "ws" → "workspace"). A letter-spread subsequence such
     as "nord" → "New Board" or "Confirm before delete" needs several mid-word
     jumps: noise once there are 150+ labels to search. */
  function plausibleMatch(query, text, m) {
    if (!m) return false;
    const raw = String(text), tl = raw.toLowerCase();
    if (tl.includes(String(query).toLowerCase())) return true;
    const at = (i) => i === 0 || isCharBoundary(tl, i) || isCamelHump(raw, i);
    if (!at(m.indices[0])) return false;
    let midJumps = 0;
    for (let k = 1; k < m.indices.length; k++) {
      const i = m.indices[k];
      if (i === m.indices[k - 1] + 1 || at(i)) continue;
      midJumps++;
    }
    return midJumps <= 1;
  }
  function labelMatch(query, text) {
    const m = fuzzyMatch(query, text);
    return plausibleMatch(query, text, m) ? m : null;
  }
  function wordPrefixMatch(query, haystack) {
    const toks = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    const words = String(haystack).toLowerCase().split(/[\s·:›\-_/,]+/).filter(Boolean);
    return toks.length > 0 && toks.every(t => words.some(w => w.startsWith(t)));
  }

  /* Score flattened items against a query. Order of attempts: the label;
     then — for multi-word queries — words that name the item's path plus a
     word of its label ("settings compact", "themes nord"); then `keywords`
     (whole-word prefixes, so "panel" finds "Toggle sidebar" but no letter
     soup does). Folders get a small bonus so a group beats its own children on
     an exact name. Returns [{ ...item, score, match }] best first. */
  function rankItems(query, flat) {
    const toks = String(query).trim().split(/\s+/).filter(Boolean);
    const out = [];
    for (const it of flat) {
      const text = it.searchLabel != null ? it.searchLabel : it.label;
      let m = labelMatch(query, text);
      if (!m && toks.length > 1) {
        const pathStr = (it.path || []).join(' ');
        let total = 0, anchored = false, ok = true;
        const idx = new Set();
        for (const tok of toks) {
          const lm = labelMatch(tok, text);
          if (lm) { anchored = true; total += lm.score; lm.indices.forEach(i => idx.add(i)); }
          else if (pathStr && wordPrefixMatch(tok, pathStr)) total += 4;
          else { ok = false; break; }
        }
        if (ok && anchored) m = { score: total - 4, indices: Array.from(idx).sort((x, y) => x - y) };
      }
      if (!m && it.keywords && wordPrefixMatch(query, it.keywords)) m = { score: 8, indices: [] };
      if (!m) continue;
      out.push(Object.assign({}, it, { match: m, score: m.score + (it.children || it.kind === 'folder' ? 3 : 0) }));
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  /* Cap each section (caps[section], default `defaultCap`) and keep sections
     ordered by their best item, with each section's items kept together so the
     UI can print one heading per section. `total` bounds the whole list. */
  function groupBySection(ranked, caps, total, defaultCap) {
    caps = caps || {};
    const dflt = defaultCap == null ? 8 : defaultCap;
    const buckets = new Map();
    for (const it of ranked) {                       // ranked is score-desc, so
      const sec = it.section || 'Results';           // first-seen order == best-first
      if (!buckets.has(sec)) buckets.set(sec, []);
      const b = buckets.get(sec);
      if (b.length < (caps[sec] != null ? caps[sec] : dflt)) b.push(it);
    }
    const out = [];
    for (const b of buckets.values()) out.push(...b);
    return total ? out.slice(0, total) : out;
  }

  return { escapeHtml, fuzzyMatch, isCharBoundary, isCamelHump, highlightLabel, flattenTree, rankItems, groupBySection, childrenOf };
});