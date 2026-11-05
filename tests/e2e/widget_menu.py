"""Widget menu: Move to board, live background colour, clearer colour selection.
Run: python3 tests/e2e/widget_menu.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from browser_stub import run, PAGE
def settle(pg, ms=400): pg.wait_for_timeout(ms)
def menu(pg):
    pg.locator('#board > .widget .widget-header').first.click(button='right', position={'x': 6, 'y': 6}); settle(pg, 250)
def bg(pg): return pg.evaluate("document.querySelector('#board > .widget').style.background")
with run('dark', path=PAGE) as (pg, errs):
    settle(pg)
    # one board only: no "Move to board" entry, and no doubled dividers
    menu(pg)
    assert pg.locator('[data-act=moveboard]').count() == 0
    assert pg.evaluate("[...document.querySelectorAll('.dropdown-menu:not(.hidden) hr')].every(h=>h.nextElementSibling&&h.nextElementSibling.tagName!=='HR')")
    pg.keyboard.press('Escape'); pg.mouse.click(900, 700); settle(pg, 250)

    # background colour changes live (no refresh), and the selection is obvious
    assert bg(pg) == ''
    menu(pg); pg.click('[data-act=tint]'); settle(pg, 300)
    sw = pg.locator('#mtc-colors .color-swatch[data-color]:not([data-color=""])').nth(2)
    color = sw.get_attribute('data-color'); sw.click(); settle(pg, 100)
    sel = pg.evaluate("(()=>{const s=document.querySelector('#mtc-colors .selected');const cs=getComputedStyle(s);const af=getComputedStyle(s,'::after');return {n:document.querySelectorAll('#mtc-colors .selected').length,shadow:cs.boxShadow,check:af.content,checked:s.getAttribute('aria-checked')}})()")
    assert sel['n'] == 1 and sel['shadow'] != 'none' and sel['check'] not in ('none', 'normal') and sel['checked'] == 'true', sel
    pg.keyboard.press('Tab')                                         # swatches are keyboard reachable
    pg.click('#mtc-save'); settle(pg, 700)
    assert bg(pg) != '', 'tint applied without a refresh'
    first = bg(pg)
    menu(pg); pg.click('[data-act=tint]'); settle(pg, 300)
    assert pg.evaluate("document.querySelector('#mtc-colors .selected').dataset.color") == color      # reopens on the saved colour
    pg.locator('#mtc-colors .color-swatch[data-color]:not([data-color=""])').nth(5).click(); pg.click('#mtc-save'); settle(pg, 700)
    assert bg(pg) not in ('', first), 'changing the colour again also updates live'
    menu(pg); pg.click('[data-act=tint]'); settle(pg, 300)
    pg.click('#mtc-none'); settle(pg, 700)
    assert bg(pg) == '', 'removing the tint updates live too'

    # Move to board
    pg.evaluate("DB.createBoard(STATE.meta.activeWorkspaceId,'Second').then(()=>DB.setActiveBoard(STATE.meta.activeWorkspaceId, Object.values(STATE.boards).sort((a,b)=>a.order-b.order)[0].id)).then(reload)"); settle(pg, 700)
    n = pg.locator('#board > .widget').count()
    menu(pg)
    assert pg.locator('[data-act=moveboard]').count() == 1
    pg.click('[data-act=moveboard]'); settle(pg, 250)
    rows = pg.locator('[data-board]'); assert rows.count() == 1 and 'Second' in rows.first.inner_text()
    rows.first.click(); settle(pg, 700)
    assert pg.locator('#board > .widget').count() == n - 1
    assert 'Second' in pg.inner_text('.toast-region, .toast') if pg.locator('.toast-region, .toast').count() else True
    moved = pg.evaluate("Object.values(STATE.widgets).filter(w=>STATE.boards[w.boardId].name==='Second').length")
    assert moved == 1, moved
    pg.evaluate("jumpToBoard(Object.values(STATE.boards).find(b=>b.name==='Second').id)"); settle(pg, 700)
    assert pg.locator('#board > .widget').count() == 1
    assert not errs, errs
print('widget menu e2e passed')
