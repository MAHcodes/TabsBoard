"""Widget size picker: square grid in the right-click menu. Run: python3 tests/e2e/size_picker.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from browser_stub import run, PAGE
def settle(pg, ms=400): pg.wait_for_timeout(ms)
def menu(pg):
    pg.locator('#board > .widget .widget-header').first.click(button='right', position={'x': 6, 'y': 6}); settle(pg, 250)
def open_size(pg):
    pg.hover('[data-sub=size]'); settle(pg, 300)
    assert pg.locator('.ws-flyout .size-grid').count() == 1
def size(pg): return pg.evaluate("(()=>{const w=Object.values(STATE.widgets).find(w=>w.type==='collection');return [w.span||1,w.rowSpan||1]})()")
with run('dark', path=PAGE) as (pg, errs):
    settle(pg)
    for cols in (4, 6, 3):
        pg.evaluate(f"DB.updateSettings({{dashboard:{{columns:{cols}}}}}).then(reload)"); settle(pg)
        menu(pg)
        assert pg.locator('.size-grid').count() == 0, 'closed until asked for'
        open_size(pg)
        assert pg.locator('.size-grid button').count() == cols * cols, cols          # square, as wide as the Board width
        assert pg.locator('.dropdown-menu [data-width], .dropdown-menu [data-height]').count() == 0   # old rows are gone
        pg.keyboard.press('Escape'); pg.mouse.click(700, 600); settle(pg, 250)
    pg.evaluate("DB.updateSettings({dashboard:{columns:4}}).then(reload)"); settle(pg)
    menu(pg)
    assert 'Size' in pg.inner_text('[data-sub=size]') and '1 × 1' in pg.inner_text('[data-sub=size]')
    open_size(pg)
    assert pg.inner_text('[data-size-readout]').strip() == '1 × 1'
    pg.hover('.size-grid button[data-c="3"][data-r="2"]'); settle(pg, 100)
    assert pg.inner_text('[data-size-readout]').strip() == '3 × 2'
    hot = pg.evaluate("[...document.querySelectorAll('.size-grid button.hot')].map(b=>b.dataset.c+','+b.dataset.r).sort()")
    assert hot == sorted(f'{c},{r}' for c in (1,2,3) for r in (1,2)), hot                  # top-left rectangle, like Excel
    pg.hover('.size-grid button[data-c="1"][data-r="1"]'); settle(pg, 100)
    assert pg.locator('.size-grid button.hot').count() == 1
    pg.click('.size-grid button[data-c="3"][data-r="2"]'); settle(pg, 600)             # one click sets both
    assert size(pg) == [3, 2], size(pg)
    assert pg.evaluate("(()=>{const c=document.querySelector('#board > .widget');return [c.dataset.span,c.dataset.rowspan]})()") == ['3', '2']
    # reopening shows the current size
    menu(pg)
    assert '3 × 2' in pg.inner_text('[data-sub=size]')
    open_size(pg)
    assert pg.inner_text('[data-size-readout]').strip() == '3 × 2' and pg.locator('.size-grid button.cur').count() == 6
    # keyboard: arrows move, Enter picks
    pg.focus('[data-sub=size]'); pg.keyboard.press('ArrowRight'); settle(pg, 200)      # → opens and focuses the grid
    assert pg.evaluate("document.activeElement.closest('.size-grid')!==null")
    pg.focus('.size-grid button[tabindex="0"]'); pg.keyboard.press('ArrowRight'); pg.keyboard.press('ArrowDown'); settle(pg, 100)
    assert pg.inner_text('[data-size-readout]').strip() == '4 × 3'
    pg.keyboard.press('Enter'); settle(pg, 600)
    assert size(pg) == [4, 3], size(pg)
    # 6 columns allow a 6 x 6 widget
    pg.evaluate("DB.updateSettings({dashboard:{columns:6}}).then(reload)"); settle(pg)
    menu(pg); open_size(pg)
    pg.click('.size-grid button[data-c="6"][data-r="6"]'); settle(pg, 600)
    assert size(pg) == [6, 6]
    # canvas keeps free resize: no picker there
    pg.click('#board-view-toggle [data-val=canvas]'); settle(pg, 800)
    menu(pg)
    assert pg.locator('[data-sub=size]').count() == 0 and pg.locator('.size-grid').count() == 0
    assert not errs, errs
print('size picker e2e passed')
