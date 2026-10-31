const BS=require('../common/bmsearch.js');
const assert=require('assert');
const D=[
 {id:1,title:'React Hooks Reference',url:'https://react.dev/reference/react/hooks',tags:['frontend','js'],description:'Built-in hooks for state and effects',notes:''},
 {id:2,title:'Google Calendar',url:'https://calendar.google.com/',tags:['work'],description:'',notes:'team standup'},
 {id:3,title:'GitHub - facebook/react',url:'https://github.com/facebook/react',tags:['js'],description:'The library for web and native user interfaces',notes:''},
 {id:4,title:'Recipes: sourdough bread',url:'https://example.com/bread',tags:['cooking'],description:'A slow ferment loaf',notes:'try with rye'},
 {id:5,title:'MDN Web Docs',url:'https://developer.mozilla.org/',tags:['docs'],description:'Resources for developers',siteName:'MDN'},
];
const top=(q)=>BS.rank(q,D).map(r=>r.item.id);
// multi-word across fields
assert.deepStrictEqual(top('react hooks')[0],1);
assert.ok(top('react').includes(3) && top('react').includes(1));
// field text
assert.deepStrictEqual(top('standup'),[2]);             // notes
assert.deepStrictEqual(top('ferment'),[4]);             // description
// tags & operators
assert.deepStrictEqual(top('#cooking'),[4]);
assert.deepStrictEqual(top('tag:js').sort(),[1,3]);
assert.deepStrictEqual(top('site:github'),[3]);
assert.deepStrictEqual(top('react -hooks'),[3]);
assert.deepStrictEqual(top('"web docs"'),[5]);
// typo + subsequence
assert.deepStrictEqual(top('calender')[0],2);           // 1 typo
assert.deepStrictEqual(top('gcal')[0],2);               // subsequence in title
assert.deepStrictEqual(top('mdn'),[5]);                 // siteName
// AND semantics
assert.deepStrictEqual(top('react bread'),[]);
// highlight indices
const r=BS.rank('hooks',D)[0]; assert.ok(r.indices.length===5 && 'React Hooks Reference'.slice(r.indices[0],r.indices[4]+1).toLowerCase()==='hooks');
// matched-in hint
assert.strictEqual(BS.rank('standup',D)[0].field,'notes');
// literal colon text isn't swallowed
assert.ok(BS.parseQuery('http://x')[0].text==='http://x');
// perf
const big=Array.from({length:5000},(_,i)=>({title:'Item '+i+' about topic '+(i%50),url:'https://site'+(i%90)+'.com/p/'+i,tags:['t'+(i%20)],description:'lorem ipsum dolor '+i,notes:''}));
let t=Date.now(); BS.rank('topic 7 lorem',big); const first=Date.now()-t; t=Date.now(); BS.rank('topik 17',big); console.log('5000 docs: cold',first,'ms, typo query',Date.now()-t,'ms');
console.log('all search tests passed');
