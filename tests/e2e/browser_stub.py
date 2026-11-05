import os, sys, json
from playwright.sync_api import sync_playwright

# The page under test, resolved from this file so the suite runs from any checkout or working directory.
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PAGE = os.path.join(ROOT, 'src', 'newtab', 'index.html')
STUB = """
(() => {
  const store = {}; const listeners = [];
  const noop = () => {};
  const evt = () => ({ addListener: noop, removeListener: noop, hasListener: () => false });
  const cbify = (fn) => (...a) => { const cb = typeof a[a.length-1]==='function' ? a.pop() : null; const r = fn(...a); if (cb) cb(r); return Promise.resolve(r); };
  window.chrome = {
    runtime: { id: 'x', lastError: null, getURL: (p)=>p, getManifest: ()=>({version:'0'}), sendMessage: cbify(()=>({})), onMessage: evt(), connect: ()=>({onMessage:evt(), postMessage:noop, disconnect:noop}), onInstalled: evt() },
    storage: { local: {
        get: cbify((k)=> { if (typeof k==='string') return k in store ? {[k]: JSON.parse(JSON.stringify(store[k]))} : {}; return {}; }),
        set: cbify((o)=> { const ch={}; for (const [k,v] of Object.entries(o)) { ch[k]={oldValue:store[k],newValue:v}; store[k]=JSON.parse(JSON.stringify(v)); } listeners.forEach(l=>l(ch,'local')); }),
        remove: cbify((k)=> { delete store[k]; }) },
      sync: { get: cbify(()=>({})), set: cbify(noop) },
      onChanged: { addListener: (l)=>listeners.push(l) } },
    tabs: { query: cbify(()=>[]), onCreated: evt(), onRemoved: evt(), onUpdated: evt(), onActivated: evt(), onMoved: evt(), onAttached: evt(), onDetached: evt(), onReplaced: evt(), create: cbify(noop), update: cbify(noop), getCurrent: cbify(()=>null) },
    windows: { getAll: cbify(()=>[]), getCurrent: cbify(()=>({id:1})), onFocusChanged: evt() },
    tabGroups: { query: cbify(()=>[]), onCreated: evt(), onUpdated: evt(), onRemoved: evt() },
    sessions: { getRecentlyClosed: cbify(()=>[]), onChanged: evt() },
    bookmarks: { getTree: cbify(()=>[]), onCreated: evt(), onRemoved: evt(), onChanged: evt(), onMoved: evt() },
    history: { search: cbify(()=>[]) }, topSites: { get: cbify(()=>[]) },
    commands: { getAll: cbify(()=>[]) }, alarms: { create: noop, onAlarm: evt() }, action: {}, i18n: { getMessage: ()=>'' },
    permissions: { contains: cbify(()=>false), request: cbify(()=>false), getAll: cbify(()=>({permissions:[],origins:[]})) },
  };
})();
"""
from contextlib import contextmanager
@contextmanager
def run(scheme, w=1280, h=900, path=PAGE):
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(color_scheme=scheme, viewport={'width':w,'height':h})
        ctx.add_init_script(STUB)
        pg = ctx.new_page()
        errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        pg.goto('file://'+path)
        pg.wait_for_timeout(1500)
        yield pg, errs
        b.close()
