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

  return { escapeHtml, fuzzyMatch, isCharBoundary, isCamelHump, highlightLabel };
});