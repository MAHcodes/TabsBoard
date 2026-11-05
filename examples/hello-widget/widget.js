/* global TabsBoard */
(async function () {
  const countEl = document.getElementById('count');
  const bmEl = document.getElementById('bm');
  let tb;
  try { tb = await TabsBoard.connect(); }
  catch (e) { countEl.textContent = '!'; bmEl.textContent = e.message; return; }

  tb.applyTheme();
  const can = (p) => tb.info.permissions.includes(p);

  let count = 0;
  if (can('storage')) count = (await tb.storage.get('count')) || 0;
  countEl.textContent = count;
  await tb.ui.setTitle('Hello Counter');

  document.getElementById('inc').onclick = async () => {
    count++;
    countEl.textContent = count;
    if (can('storage')) tb.storage.set('count', count).catch(e => console.warn(e.message));
    if (count % 10 === 0 && can('ui.toast')) tb.ui.toast('You reached ' + count + ' clicks!', 'success');
  };

  let bookmarks = [];
  if (can('bookmarks.read')) { bookmarks = await tb.bookmarks.list({ limit: 20 }); bmEl.textContent = bookmarks.length + ' bookmarks visible to this widget'; }
  else bmEl.textContent = 'bookmarks.read not granted';

  document.getElementById('open').onclick = async () => {
    if (!can('tabs.open') || !bookmarks.length) return;
    const b = bookmarks[Math.floor(Math.random() * bookmarks.length)];
    try { await tb.tabs.open(b.url); } catch (e) { console.warn(e.code, e.message); }
  };

  // Pause work while the card is off-screen / the tab is hidden.
  tb.on('visibility', ({ visible }) => { document.body.style.opacity = visible ? 1 : 0.6; });
})();
