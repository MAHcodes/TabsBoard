"""Real-browser check of the Themes panel (Chromium via Playwright, stubbed chrome API).
Run: python3 tests/e2e/themes_panel.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from browser_stub import run
PAGE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'newtab', 'index.html'))

def state(pg):
    return pg.evaluate("""()=>({mode:document.querySelector('#theme-mode .active').dataset.val,
      current:document.querySelector('.tc-name').innerText,
      marked:[...document.querySelectorAll('.theme-swatch-card.selected,.theme-swatch-card.slot-pick')].map(c=>c.dataset.themeId+(c.classList.contains('selected')?'*':'')),
      filter:document.querySelector('#theme-type-filter .active').dataset.val})""")

for scheme, expect in (('dark', 'Iceberg Dark'), ('light', 'Iceberg Light')):
    with run(scheme, path=PAGE) as (pg, errs):
        pg.click('#settings-btn'); pg.click('.settings-tab[data-tab="themes"]'); pg.wait_for_timeout(400)
        s = state(pg)
        assert s['current'] == expect and s['mode'] == 'auto', s            # fresh install = Iceberg, Auto
        assert sorted(s['marked']) == ['iceberg_dark' + ('*' if scheme == 'dark' else ''), 'iceberg_light' + ('*' if scheme == 'light' else '')], s
        other = 'light' if scheme == 'dark' else 'dark'
        pick = 'gruvbox_light' if scheme == 'dark' else 'nord'
        pg.click(f'.theme-swatch-card[data-theme-id="{pick}"]'); pg.wait_for_timeout(300)
        s = state(pg)
        assert s['mode'] == 'auto' and s['current'] == expect, s            # Auto stays on; what's showing is unchanged
        assert pick in s['marked'], s                                       # ...and the other mode's slot took the pick
        pg.click(f'.auto-slot[data-key="{other}"]'); pg.wait_for_timeout(300)
        assert state(pg)['filter'] == other                                 # slot click filters the grid
        pg.click('#theme-type-filter button[data-val="all"]')
        pg.click('#theme-mode button[data-val="fixed"]'); pg.wait_for_timeout(300)
        assert state(pg)['mode'] == 'fixed'
        pg.click('.theme-swatch-card[data-theme-id="nord"]'); pg.wait_for_timeout(300)
        s = state(pg); assert s['current'] == 'Nord' and s['marked'] == ['nord*'], s
        assert not errs, errs
print('themes panel e2e passed')
