"""Board views (grid / canvas / split), the toolbar switcher, and the bookmark popup header.
Run: python3 tests/e2e/board_views.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from browser_stub import run, PAGE
def vis(pg, sel): return pg.evaluate("s=>{const n=document.querySelector(s);if(!n)return false;const b=n.getBoundingClientRect();return getComputedStyle(n).display!=='none'&&b.width>0&&b.height>0}", sel)
def settle(pg, ms=500): pg.wait_for_timeout(ms)
def active(pg, sel): return pg.evaluate("s=>{const b=document.querySelector(s+' button.active');return b&&b.dataset.val}", sel)
with run('dark', path=PAGE) as (pg, errs):
    pg.evaluate("""async()=>{const s=await DB.getState();const c=Object.values(s.collections)[0];
      await DB.createBookmark(c.id,s.meta.activeWorkspaceId,{title:'Alpha',url:'https://alpha.test'});
      await DB.createBookmark(c.id,s.meta.activeWorkspaceId,{title:'Beta',url:'https://beta.test'});
      await DB.createCollection(s.meta.activeWorkspaceId,'Second');await reload();}""")
    settle(pg)
    # the toolbar switcher is there, Grid is the default, nothing else is on screen
    assert pg.locator('#board-view-toggle button').count() == 3 and active(pg, '#board-view-toggle') == 'grid'
    assert not vis(pg, '#pane-list') and not vis(pg, '#canvas-tidy-btn') and not vis(pg, '#inspector')

    # every view is reachable from every other one
    pg.click('#board-view-toggle [data-val=split]'); settle(pg)
    assert vis(pg, '#pane-list') and pg.locator('#pane-list .pane-item').count() >= 2 and pg.locator('#board > .widget').count() == 1
    pg.locator('#pane-list .pane-item').nth(1).click(); settle(pg, 200)
    assert pg.locator('#pane-list .pane-item.active').count() == 1
    assert pg.evaluate("getComputedStyle(document.querySelector('.pane-item.active')).boxShadow") == 'none'
    pg.click('#board-view-toggle [data-val=canvas]'); settle(pg, 800)           # split -> canvas, the old dead end
    assert not vis(pg, '#pane-list') and vis(pg, '#canvas-tidy-btn')
    assert pg.evaluate("document.querySelector('#board').classList.contains('canvas')")
    assert pg.locator('#board > .widget').count() >= 2
    box = pg.locator('#board > .widget').first.bounding_box()
    hdr = pg.locator('#board > .widget > .widget-header').first.bounding_box()
    pg.mouse.move(hdr['x'] + 60, hdr['y'] + 10); pg.mouse.down(); pg.mouse.move(hdr['x'] + 163, hdr['y'] + 71, steps=5); pg.mouse.up(); settle(pg, 600)
    after = pg.locator('#board > .widget').first.bounding_box()
    dx, dy = after['x'] - box['x'], after['y'] - box['y']
    assert dx > 60 and dy > 40 and dx % 20 == 0 and dy % 20 == 0, (dx, dy)      # moved and snapped
    pg.click('#board-view-toggle [data-val=grid]'); settle(pg)
    assert not vis(pg, '#canvas-tidy-btn') and not pg.evaluate("document.querySelector('#board').classList.contains('canvas')")

    # per-board: a second board keeps its own view, and the first one remembers canvas
    pg.click('#board-view-toggle [data-val=canvas]'); settle(pg, 700)
    assert pg.evaluate("document.querySelector('#board').classList.contains('canvas')")
    pg.evaluate("DB.createBoard(STATE.meta.activeWorkspaceId,'Second').then(reload)"); settle(pg, 700)
    assert active(pg, '#board-view-toggle') == 'grid' and not vis(pg, '#canvas-tidy-btn'), 'new board follows the default'
    assert not pg.evaluate("document.querySelector('#board').classList.contains('canvas')")
    pg.click('#board-view-toggle [data-val=split]'); settle(pg, 600)
    assert vis(pg, '#pane-list')
    boards = pg.evaluate("Object.values(STATE.boards).sort((a,b)=>a.order-b.order).map(b=>[b.name,b.boardMode||null])")
    assert boards == [['Board 1', 'canvas'], ['Second', 'split']], boards
    pg.evaluate("jumpToBoard(Object.values(STATE.boards).find(b=>b.name==='Board 1').id)"); settle(pg, 800)
    assert active(pg, '#board-view-toggle') == 'canvas' and vis(pg, '#canvas-tidy-btn') and not vis(pg, '#pane-list')
    # Settings -> Board: "This board" can hand the choice back to the default
    pg.keyboard.press('s'); settle(pg, 300)
    pg.click('.settings-tab[data-tab=board]'); settle(pg, 200)
    assert active(pg, '#boardview-this-toggle') == 'canvas' and 'Board 1' in pg.inner_text('#boardview-this-name')
    assert active(pg, '#boardview-toggle') == 'grid'
    pg.click('#boardview-this-toggle [data-val=default]'); settle(pg, 600)
    assert active(pg, '#board-view-toggle') == 'grid' and 'Following the default' in pg.inner_text('#boardview-hint')
    pg.click('#boardview-toggle [data-val=canvas]'); settle(pg, 600)                 # change the default: this board follows
    assert active(pg, '#board-view-toggle') == 'canvas'
    pg.click('#boardview-toggle [data-val=grid]'); settle(pg, 400)
    pg.keyboard.press('Escape'); settle(pg, 300)
    # palette offers the other views for this board
    pg.keyboard.press('Control+k'); pg.keyboard.type('this board'); settle(pg, 400)
    assert 'Canvas (this board)' in pg.inner_text('#palette-results') or 'Split view' in pg.inner_text('#palette-results') or 'Split (this board)' in pg.inner_text('#palette-results')
    pg.keyboard.press('Escape'); pg.keyboard.press('Escape'); settle(pg, 300)

    # Settings -> Board mirrors the switcher, and hides the column picker when it doesn't apply
    pg.evaluate('openSettings()'); settle(pg, 300)
    pg.click('.settings-tab[data-tab=board]'); settle(pg, 200)
    assert active(pg, '#boardview-toggle') == 'grid' and vis(pg, '#row-board-cols')
    pg.click('#boardview-toggle [data-val=canvas]'); settle(pg, 500)
    assert active(pg, '#board-view-toggle') == 'canvas' and not vis(pg, '#row-board-cols')
    assert pg.inner_text('#boardview-hint').strip() != ''
    pg.click('#boardview-toggle [data-val=grid]'); settle(pg, 400)
    assert pg.locator('.settings-tab[data-tab=navigation]').count() == 1 and pg.locator('#panel-navigation #setting-sidebar-collapsed').count() == 1
    pg.keyboard.press('Escape'); settle(pg, 300)

    # the bookmark popup is back, with the favicon / title / host header and no panel
    pg.locator('.bookmark-item, .bookmark-tile').first.hover()
    pg.evaluate("openBookmarkModal(Object.values(STATE.bookmarks)[0])"); settle(pg, 300)
    assert vis(pg, '.modal .entity-head') and not vis(pg, '#inspector')
    assert pg.inner_text('.modal .entity-heading h2').strip() == 'Alpha' and 'alpha.test' in pg.inner_text('.modal .entity-sub')
    assert pg.locator('.modal .entity-head button').count() == 0
    pg.screenshot(path='/tmp/popup.png')
    pg.keyboard.press('Escape'); settle(pg, 200)
    pg.evaluate("openBookmarkModal(null, Object.values(STATE.collections)[0].id)"); settle(pg, 300)
    assert 'Add bookmark' in pg.inner_text('.modal .entity-heading h2')
    assert not errs, errs
print('board views e2e passed')
