"""Real-browser check of the Floating bars setting. Run: python3 tests/e2e/floating_bars.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from browser_stub import run
PAGE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'newtab', 'index.html'))
R = """()=>{const r=s=>{const b=document.querySelector(s).getBoundingClientRect();return [Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)]};
 return {cls:document.documentElement.className, top:r('.topbar'), side:r('#sidebar'), main:r('#main')}}"""
with run('dark', path=PAGE) as (pg, errs):
    off = pg.evaluate(R)
    assert 'floating-bars' not in off['cls'] and off['top'] == [0, 0, 1280, 60], off          # off by default, flush to the edges
    pg.click('#settings-btn'); pg.click('.settings-tab[data-tab="appearance"]')
    assert not pg.is_checked('#setting-floating-bars')
    pg.evaluate("document.querySelector('#setting-floating-bars').click()"); pg.wait_for_timeout(500)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    on, g = pg.evaluate(R), 12
    assert 'floating-bars' in on['cls']
    assert on['top'][:3] == [g, g, 1280 - g]                                                  # gap left / top / right of the bar
    assert on['side'][0] == g and on['side'][3] == 900 - g                                    # sidebar inset left / bottom
    assert on['side'][1] == on['top'][3] + g and on['main'][0] == on['side'][2] + g           # gaps between the panels
    pg.evaluate("DB.updateSettings({sidebarCollapsed:true})"); pg.wait_for_timeout(500)
    assert pg.evaluate(R)['main'][0] == g                                                     # collapsed: no leftover gap
    pg.evaluate("DB.updateSettings({sidebarCollapsed:false, floatingBars:false})"); pg.wait_for_timeout(500)
    back = pg.evaluate(R)
    assert back['top'] == off['top'] and back['side'] == off['side'] and back['main'] == off['main']
    assert not errs, errs
print('floating bars e2e passed')
