import sys, json
from playwright.sync_api import sync_playwright
css_path = sys.argv[1]
HTML = """<!doctype html><html><head><link rel=stylesheet href="file://%s"></head><body>
<div class="modal"><div class="settings-group"><div class="settings-row" id="row">
  <div class="segmented" id="seg"><button class="active">A</button><button>B</button></div>
  <div class="count-picker" id="cp"><div class="segmented"><button>1</button></div><input type="number"></div>
  <div class="switch-row"><span>x</span><label class="switch"><input type="checkbox"><span class="switch-track"><span class="switch-thumb"></span></span></label></div>
  <div class="switch-row" id="sr2"><span>y</span></div>
</div></div></div>
<div class="toast" id="toast"><span class="toast-ic" id="tic"></span><div class="toast-msg">m</div><span class="toast-count" id="tcount">2</span><button class="toast-action" id="tact">Undo</button><button class="toast-close" id="tclose"></button></div>
<span class="count-pill" id="pill">3</span><div class="plugin-row" id="prow"></div><span class="plugin-dev-badge" id="pbadge">dev</span>
<label class="import-option" id="iopt"><input type=radio></label><div class="theme-swatch-card" id="tcard"></div><span class="color-swatch" id="sw"></span>
</body></html>""" % css_path
radii = {'default':None,'sharp':'radius-sharp','rounded':'radius-rounded','extra':'radius-extra','none':'radius-none'}
dens  = {'comfortable':'', 'compact':'density-compact','dense':'density-compact density-dense','spacious':'density-spacious'}
out={}
with sync_playwright() as p:
    b=p.chromium.launch(); open("/tmp/h/page.html","w").write(HTML); pg=b.new_page(); pg.goto("file:///tmp/h/page.html"); pg.wait_for_timeout(200)
    for rn,rc in radii.items():
        for dn,dc in dens.items():
            cls=' '.join(x for x in [rc,dc] if x)
            pg.evaluate("c=>document.documentElement.className=c", cls)
            r=pg.evaluate("""()=>{
              const g=(sel,prop)=>getComputedStyle(document.querySelector(sel))[prop];
              return {
               row:g('#row','borderTopLeftRadius'), modal:g('.modal','borderTopLeftRadius'),
               toast:g('#toast','borderTopLeftRadius'), ctrl:g('#seg','borderTopLeftRadius'),
               segbtn:g('#seg button','borderTopLeftRadius'), segpad:g('#seg button','paddingTop'),
               tic:g('#tic','borderTopLeftRadius'), tcount:g('#tcount','borderTopLeftRadius'),
               pill:g('#pill','borderTopLeftRadius'), pbadge:g('#pbadge','borderTopLeftRadius'),
               prow:g('#prow','borderTopLeftRadius'), swatch:g('#sw','borderTopLeftRadius'),
               swh:g('.switch','height'), stack:g('#sr2','marginTop'), cpbtn:g('#cp button','borderTopLeftRadius'),
               tact:g('#tact','borderTopLeftRadius')}
            }""")
            out[f"{rn}/{dn}"]=r
    b.close()
json.dump(out,open(sys.argv[2],'w'),indent=1)
