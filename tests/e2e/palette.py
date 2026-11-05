"""Real-browser check of the command palette (Chromium via Playwright, stubbed chrome API).
Run: python3 tests/e2e/palette.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from browser_stub import run, PAGE

def snap(pg):
    return pg.evaluate("""()=>({
      open: !document.querySelector('#palette-overlay').classList.contains('hidden'),
      sections: [...document.querySelectorAll('.palette-section')].map(e=>e.textContent),
      rows: [...document.querySelectorAll('.palette-item')].map(r=>r.querySelector('.pi-label').textContent),
      active: (document.querySelector('.palette-item.active .pi-label')||{}).textContent,
      checked: [...document.querySelectorAll('.palette-item')].filter(r=>r.querySelector('.pi-check')).map(r=>r.querySelector('.pi-label').textContent),
      crumb: document.querySelector('#palette-crumb').classList.contains('hidden') ? '' : document.querySelector('#palette-crumb').innerText.replace(/\\s+/g,' ').trim(),
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim(),
      foot: document.querySelector('#palette-foot').innerText.replace(/\\s+/g,' ').trim(),
    })""")

for scheme in ('dark', 'light'):
    with run(scheme, path=PAGE) as (pg, errs):
        base_bg = snap(pg)['bg']
        NORD = pg.evaluate("()=>Themes.findTheme('nord').bg")
        pg.keyboard.press('Control+k'); pg.wait_for_timeout(200)
        s = snap(pg)
        assert s['open'], s
        # root is grouped, not one flat wall of commands
        assert s['sections'][:2] == ['Customize', 'Create'] and 'Navigate' in s['sections'] and 'View' in s['sections'], s
        assert 'Themes' in s['rows'] and 'Settings' in s['rows'] and 'Add widget' in s['rows'], s
        assert not any(r.startswith('Add Notes') for r in s['rows']), s     # widgets live in their own group now

        # Ctrl+K toggles
        pg.keyboard.press('Control+k'); pg.wait_for_timeout(100)
        assert not snap(pg)['open']
        pg.keyboard.press('Control+k'); pg.wait_for_timeout(100)

        # typing at the root reaches individual setting values and themes
        pg.keyboard.type('compact'); pg.wait_for_timeout(150)
        s = snap(pg)
        assert 'Settings' in s['sections'] and 'Density: Compact' in s['rows'], s
        pg.fill('#palette-input', 'nord'); pg.wait_for_timeout(150)
        s = snap(pg)
        assert s['active'] == 'Nord' and 'Themes' in s['sections'], s
        assert s['bg'] == base_bg, ('typing must not live-preview a theme', s)   # no flicker while typing
        assert any('Search the web for' in r for r in s['rows']), s           # web fallback row

        # arrowing onto a theme previews it; Esc (clear query) then drops the preview
        pg.fill('#palette-input', 'dracula'); pg.wait_for_timeout(100)
        pg.keyboard.press('ArrowDown'); pg.keyboard.press('ArrowUp'); pg.wait_for_timeout(100)
        s = snap(pg); assert s['active'] == 'Dracula' and s['bg'] != base_bg, s
        pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
        s = snap(pg); assert s['open'] and s['bg'] == base_bg and not pg.input_value('#palette-input'), s
        # Enter applies + closes
        pg.fill('#palette-input', 'nord'); pg.wait_for_timeout(100)
        pg.keyboard.press('Enter'); pg.wait_for_timeout(400)
        s = snap(pg); assert not s['open'] and s['bg'] == NORD, s

        # Themes group: opens on the current theme, preview follows the cursor, leaving reverts
        pg.keyboard.press('Control+k'); pg.wait_for_timeout(150)
        pg.fill('#palette-input', 'themes'); pg.wait_for_timeout(100)
        pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
        s = snap(pg)
        assert s['crumb'] == 'All › Themes', s
        assert s['active'] == 'Nord' and s['checked'] == ['Nord'], s          # starts on the active theme
        assert {'Dark themes', 'Light themes'} <= set(s['sections']), s
        pg.keyboard.press('ArrowDown'); pg.wait_for_timeout(100)
        assert snap(pg)['bg'] != NORD
        pg.keyboard.press('ArrowLeft'); pg.wait_for_timeout(150)               # back to root: preview reverted
        s = snap(pg); assert s['crumb'] == '' and s['bg'] == NORD and s['active'] == 'Themes', s

        # Settings: reach a setting folder by search -> full breadcrumb, option check updates live
        pg.fill('#palette-input', 'density'); pg.wait_for_timeout(100)
        assert snap(pg)['active'] == 'Density'
        pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
        s = snap(pg)
        assert s['crumb'] == 'All › Settings › Appearance › Density', s
        assert len(s['checked']) == 1, s
        before = s['checked'][0]
        target = 'Compact' if before != 'Compact' else 'Spacious'
        pg.fill('#palette-input', target); pg.wait_for_timeout(100)
        pg.keyboard.press('Enter'); pg.wait_for_timeout(400)
        s = snap(pg)
        assert s['open'] and s['checked'] == [target], ('check mark must follow the new value', s)
        # caret keys must not leave the group while there is text to edit
        pg.keyboard.press('ArrowLeft'); pg.wait_for_timeout(100)
        assert snap(pg)['crumb'].endswith('Density'), snap(pg)
        # Esc: clear query -> Esc: up a level (Appearance) -> ... -> close
        pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
        assert snap(pg)['crumb'].endswith('Density') and not pg.input_value('#palette-input')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
        assert snap(pg)['crumb'] == 'All › Settings › Appearance'
        assert snap(pg)['active'] == 'Density'                                  # Back restores the row you came from
        pg.keyboard.press('Backspace'); pg.keyboard.press('Backspace'); pg.wait_for_timeout(100)
        assert snap(pg)['crumb'] == ''
        pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
        assert not snap(pg)['open']
        assert not errs, errs
print('command palette e2e passed')
