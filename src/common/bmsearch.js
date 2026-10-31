/* TabsBoard — multi-field search for bookmarks, open tabs and anything else
   shaped like { title, url, tags, description, notes, siteName }.
   Pure functions, no chrome/DOM dependencies (unit-tested in node).
   Exposes `self.BookmarkSearch` in the browser and `module.exports` in node.

   Why not just fuzzyMatch(title) / fuzzyMatch(url)? That is a single-string
   subsequence match: it can't combine words ("react hooks" only works if the
   letters happen to appear in order in ONE field), it ignores tags, notes and
   the page description, and typos find nothing. This ranks per word:

     - the query is split into terms; every term must match somewhere (AND);
     - each term is scored against each field with a weight, by match quality:
         whole word > word prefix > inside a word > one-or-two-letter typo >
         loose subsequence (title only, "gcal" -> "Google Calendar");
     - bonuses for the whole query being a prefix/phrase of the title;
     - operators: tag:foo  #foo  site:github.com  url:docs  note:todo
       "exact phrase"  -excluded
     - it returns the title character positions to highlight, in the same
       shape SearchUtils.highlightLabel() already consumes.                    */
(function (root, factory) {
  const api = factory(root.SearchUtils || (typeof require !== 'undefined' ? require('./search.js') : null));
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BookmarkSearch = api;
})(typeof self !== 'undefined' ? self : globalThis, function (SearchUtils) {
  const FIELD_WEIGHT = { title: 10, tags: 7, site: 6, url: 4, description: 2.5, notes: 2 };
  const FIELD_LABEL = { title: 'title', tags: 'tag', site: 'site', url: 'url', description: 'description', notes: 'notes' };
  const OPERATOR_FIELD = { tag: 'tags', tags: 'tags', site: 'site', host: 'site', url: 'url', note: 'notes', notes: 'notes', desc: 'description', title: 'title' };
  const SCORE_SCALE = 1.5; // keeps bookmark scores comparable with the palette's command scores

  /* ---------- parsing ---------- */
  function parseQuery(raw) {
    const terms = [];
    const re = /(-?)(?:([a-z]+):)?("([^"]*)"|#?[^\s"]+)/gi;
    let m;
    const s = String(raw || '');
    while ((m = re.exec(s))) {
      let [, neg, op, token, quoted] = m;
      let phrase = quoted !== undefined;
      let text = phrase ? quoted : token;
      let field = null;
      if (op && OPERATOR_FIELD[op.toLowerCase()]) field = OPERATOR_FIELD[op.toLowerCase()];
      else if (op) text = op + ':' + text; // not an operator ("c:", "http:") — keep literally
      if (!phrase && text[0] === '#' && text.length > 1) { field = 'tags'; text = text.slice(1); }
      text = text.toLowerCase().trim();
      if (!text) continue;
      terms.push({ text, field, phrase, negate: neg === '-' });
    }
    return terms;
  }

  /* ---------- per-item normalisation (cached) ---------- */
  const cache = new WeakMap();
  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; }
  }
  function words(s) { return String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
  function prepare(item) {
    const sig = [item.title, item.url, (item.tags || []).join(','), item.description, item.notes, item.siteName].join('\u0001');
    const hit = cache.get(item);
    if (hit && hit.sig === sig) return hit;
    const tags = (item.tags || []).map(t => String(t).toLowerCase());
    const host = hostOf(item.url);
    const site = [host, String(item.siteName || '').toLowerCase()].filter(Boolean).join(' ');
    const f = {
      sig,
      raw: { title: String(item.title || ''), url: String(item.url || ''), tags: tags.join(' '), site, description: String(item.description || ''), notes: String(item.notes || '') },
      low: {}, words: {}
    };
    for (const k of Object.keys(f.raw)) { f.low[k] = f.raw[k].toLowerCase(); f.words[k] = words(f.raw[k]); }
    f.tagList = tags;
    cache.set(item, f);
    return f;
  }

  /* ---------- typo tolerance ---------- */
  // Damerau-Levenshtein with an early-out bound; only used on short words.
  function withinEdits(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return false;
    const m = a.length, n = b.length;
    let prev2 = null, prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return false;
      prev2 = prev; prev = cur;
    }
    return prev[n] <= max;
  }
  function typoBudget(len) { return len >= 8 ? 2 : len >= 4 ? 1 : 0; }

  /* ---------- matching one term against one field ---------- */
  // Returns { q: quality 0..1, start, end } (positions in the lowercased field) or null.
  function matchTerm(term, f, field) {
    const low = f.low[field];
    if (!low) return null;
    const t = term.text;
    if (term.phrase) {
      const i = low.indexOf(t);
      return i < 0 ? null : { q: 1, start: i, end: i + t.length };
    }
    const ws = f.words[field];
    // whole word / word prefix, scanning words in order so highlights land on the right one
    let pos = 0, best = null;
    for (let k = 0; k < ws.length; k++) {
      const w = ws[k];
      const at = low.indexOf(w, pos);
      pos = at + w.length;
      let q = 0;
      if (w === t) q = 1;
      else if (w.startsWith(t)) q = 0.85 - Math.min(0.1, (w.length - t.length) * 0.01);
      if (q && (!best || q > best.q)) { best = { q, start: at, end: at + t.length }; if (q === 1) break; }
    }
    if (best) return best;
    // field-level substring (covers URLs, "ctrl+k", mid-word hits)
    if (t.length >= 2) {
      const i = low.indexOf(t);
      if (i >= 0) return { q: 0.5, start: i, end: i + t.length };
    }
    // typos, on whole words only — short, human-typed fields (not URLs/notes/descriptions: too noisy and slow)
    const budget = (field === 'title' || field === 'tags' || field === 'site') ? typoBudget(t.length) : 0;
    if (budget) {
      pos = 0;
      for (let k = 0; k < ws.length; k++) {
        const w = ws[k];
        const at = low.indexOf(w, pos);
        pos = at + w.length;
        if (withinEdits(t, w, budget) || (w.length > t.length && withinEdits(t, w.slice(0, t.length), budget))) {
          return { q: 0.5, start: at, end: at + Math.min(w.length, t.length) };
        }
      }
    }
    // loose subsequence — title only, and only for 3+ letter terms ("gcal" -> Google Calendar)
    if (field === 'title' && t.length >= 3 && SearchUtils) {
      const m = SearchUtils.fuzzyMatch(t, f.raw.title);
      if (m && m.indices.length) return { q: Math.min(0.4, 0.15 + m.score / 80), indices: m.indices };
    }
    return null;
  }

  /* ---------- ranking ---------- */
  /* Score one item. Returns null when it doesn't match (every non-negated term
     must hit some field; any negated term that hits excludes it), else
     { score, indices (title highlight), field (best non-title field that
     contributed, for a "matched in notes" hint) }. */
  function scoreItem(terms, item) {
    const f = prepare(item);
    let total = 0;
    const hl = new Set();
    let hintField = null, hintScore = 0;
    for (const term of terms) {
      const fields = term.field ? [term.field] : ['title', 'tags', 'site', 'url', 'description', 'notes'];
      let bestScore = 0, bestField = null, bestHit = null;
      for (const field of fields) {
        const hit = matchTerm(term, f, field);
        if (!hit) continue;
        const s = FIELD_WEIGHT[field] * hit.q;
        if (s > bestScore) { bestScore = s; bestField = field; bestHit = hit; }
        if (field === 'title' && hit.q >= 0.85) break; // can't be beaten by a lower-weight field
      }
      if (term.negate) { if (bestField) return null; continue; }
      if (!bestField) return null;
      total += bestScore;
      if (bestField === 'title') {
        if (bestHit.indices) bestHit.indices.forEach(i => hl.add(i));
        else for (let i = bestHit.start; i < bestHit.end; i++) hl.add(i);
      } else if (bestScore > hintScore) { hintScore = bestScore; hintField = bestField; }
    }
    const positive = terms.filter(t => !t.negate && !t.field);
    if (positive.length) {
      const whole = positive.map(t => t.text).join(' ');
      const title = f.low.title;
      if (title === whole) total += 12;
      else if (title.startsWith(whole)) total += 6;
      else if (title.includes(whole)) total += 3;
    }
    if (!total && terms.every(t => t.negate)) total = 1; // only exclusions: everything not excluded
    if (item.pinned) total += 0.5;
    return { score: total * SCORE_SCALE, indices: Array.from(hl).sort((a, b) => a - b), field: hintField ? FIELD_LABEL[hintField] : null };
  }

  /* rank(query, items, { limit, map }) -> [{ item, score, indices, field }] best first.
     `map` adapts foreign shapes: map(item) -> { title, url, tags, description, notes, siteName }. */
  function rank(query, items, opts) {
    const o = opts || {};
    const terms = parseQuery(query);
    if (!terms.length) return [];
    const out = [];
    for (const item of items) {
      const doc = o.map ? o.map(item) : item;
      const r = scoreItem(terms, doc);
      if (r) { r.item = item; out.push(r); }
    }
    out.sort((a, b) => b.score - a.score || (String(a.item.title || '').length - String(b.item.title || '').length));
    return o.limit ? out.slice(0, o.limit) : out;
  }

  /* Convenience for filter boxes: does this item match at all? */
  function matches(query, item) {
    const terms = parseQuery(query);
    return !terms.length || !!scoreItem(terms, item);
  }

  return { parseQuery, scoreItem, rank, matches, withinEdits };
});
