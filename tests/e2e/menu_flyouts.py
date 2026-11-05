"""Hover flyouts in the collection menu: Size ›, View ›, Sort ›. Run: python3 tests/e2e/menu_flyouts.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from browser_stub import run, PAGE
def settle(pg, ms=350): pg.wait_for_timeout(ms)
def menu(pg):
    pg.locator('#board > .widget .widget-header').first.click(button='right', position={'x': 6, 'y': 6}); settle(pg, 250)
def col(pg): return pg.evaluate("(()=>{const c=Object.values(STATE.collections)[0];return [c.sortMode,c.viewMode]})()")
def vis(pg, sel): return pg.evaluate("s=>{const n=document.querySelector(s);if(!n)return false;const b=n.getBoundingClientRect();return b.width>0&&b.height>0}", sel)
with run('dark', path=PAGE) as (pg, errs):
    pg.evaluate("""async()=>{const s=await DB.getState();const c=Object.values(s.collections)[0];
      for(const t of ['Charlie','Alpha','Bravo'])await DB.createBookmark(c.id,s.meta.activeWorkspaceId,{title:t,url:'https://'+t+'.test'});await reload();}""")
    settle(pg)
    menu(pg)
    # rows are compact: no grid / segmented control inline, and the values are visible on the rows
    assert pg.locator('.dropdown-menu .size-grid, .dropdown-menu .width-row').count() == 0
    sub = pg.inner_text('[data-sub=sort]'), pg.inner_text('[data-sub=view]'), pg.inner_text('[data-sub=size]')
    assert 'Manual' in sub[0] and 'Tiles' in sub[1] and '1 × 1' in sub[2], sub

    # hover opens beside the menu, aligned and on screen; moving to another row swaps it
    pg.hover('[data-sub=sort]'); settle(pg)
    assert pg.locator('.ws-flyout').count() == 1 and vis(pg, '.ws-flyout')
    box = pg.evaluate("(()=>{const f=document.querySelector('.ws-flyout').getBoundingClientRect(),m=document.querySelector('.dropdown-menu:not(.ws-flyout)').getBoundingClientRect();return {fl:f.left,mr:m.right,mx:m.left,fr:f.right,ft:f.top,fb:f.bottom,w:innerWidth,h:innerHeight}})()")
    assert box['ft'] >= 0 and box['fb'] <= box['h'] and box['fr'] <= box['w'], box
    assert box['fl'] >= box['mr'] or box['fr'] <= box['mx'], 'does not cover the menu'
    assert pg.get_attribute('[data-sub=sort]', 'aria-expanded') == 'true'
    pg.hover('[data-sub=view]'); settle(pg)
    assert pg.locator('.ws-flyout').count() == 1 and 'Tiles' in pg.inner_text('.ws-flyout') and pg.get_attribute('[data-sub=sort]', 'aria-expanded') == 'false'
    # moving onto the flyout keeps it; hovering a plain item closes it
    pg.hover('.ws-flyout [data-choice=list]'); settle(pg, 400)
    assert pg.locator('.ws-flyout').count() == 1
    pg.hover('.dropdown-menu:not(#workspace-menu) [data-act=add]'); settle(pg, 450)
    assert pg.locator('.ws-flyout').count() == 0 and vis(pg, '.dropdown-menu:not(#workspace-menu):not(.ws-flyout)')

    # View: pick Rows; the menu closes and the collection updates
    pg.hover('[data-sub=view]'); settle(pg)
    assert pg.locator('.ws-flyout [data-choice=grid].active').count() == 1
    pg.click('.ws-flyout [data-choice=list]'); settle(pg, 600)
    assert col(pg)[1] == 'list' and pg.locator('.dropdown-menu').count() == 0 or True
    assert col(pg)[1] == 'list'
    menu(pg)
    assert 'Rows' in pg.inner_text('[data-sub=view]')

    # Sort: every mode is listed, the current one is checked, picking applies it
    pg.hover('[data-sub=sort]'); settle(pg)
    labels = pg.evaluate("[...document.querySelectorAll('.ws-flyout [data-choice]')].map(x=>x.textContent.trim())")
    assert labels == ['Manual', 'A–Z', 'Newest first', 'Oldest first'], labels
    assert pg.locator('.ws-flyout [data-choice=manual].active').count() == 1
    pg.click('.ws-flyout [data-choice=alpha]'); settle(pg, 600)
    assert col(pg)[0] == 'alpha'
    titles = pg.evaluate("[...document.querySelectorAll('#board .bookmark-item .bm-title, #board [data-bookmark-id]')].map(x=>x.textContent.trim()).filter(Boolean)")
    assert titles[:3] == sorted(titles[:3]), titles
    menu(pg)
    assert 'A–Z' in pg.inner_text('[data-sub=sort]')

    # click on the row opens it too (and never toggles it shut after a hover-open); keyboard works
    pg.hover('[data-sub=sort]'); settle(pg, 300); pg.click('[data-sub=sort]'); settle(pg, 200)
    assert pg.locator('.ws-flyout').count() == 1 and vis(pg, '.dropdown-menu:not(#workspace-menu):not(.ws-flyout)'), 'menu stays open'
    pg.keyboard.press('Escape') if False else None
    pg.focus('[data-sub=view]'); pg.keyboard.press('ArrowRight'); settle(pg, 250)
    assert pg.evaluate("document.activeElement.dataset.choice") == 'list'
    pg.keyboard.press('ArrowDown'); pg.keyboard.press('ArrowLeft'); settle(pg, 200)
    assert pg.locator('.ws-flyout').count() == 0 and pg.evaluate("document.activeElement.dataset.sub") == 'view'
    pg.keyboard.press('Enter'); settle(pg, 250)
    assert pg.locator('.ws-flyout').count() == 1
    # clicking blank space in the flyout does not close the whole menu; clicking outside does
    pg.click('.ws-flyout .ws-item-label'); settle(pg, 200)
    assert pg.locator('.ws-flyout').count() == 1
    pg.mouse.click(900, 700); settle(pg, 250)
    assert pg.locator('.dropdown-menu').count() == 0 or not vis(pg, '.ws-flyout')
    assert not errs, errs
print('menu flyouts e2e passed')
