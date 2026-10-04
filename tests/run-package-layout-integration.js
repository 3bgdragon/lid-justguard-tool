'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const workspace=path.resolve(__dirname,'../..'),source=path.resolve(process.argv[2]),limit=Number(process.argv[3]||24);
const root=fs.mkdtempSync(path.join(workspace,'lid-justguard-tool/.integration-temp/layout-orders-'));
function load(repo,file,expression){const script=path.join(workspace,repo,file),ctx=vm.createContext({require:createRequire(script),__dirname:path.dirname(script),Buffer,console,process,testBackup:path.join(root,'legacy-backups')});vm.runInContext(fs.readFileSync(script,'utf8').split('\nmain().catch')[0]+expression,ctx);return ctx.api;}
const guard=load('lid-justguard-tool','lid-justguard.js','\nisGameRunning=()=>false;backupRoot=()=>testBackup;globalThis.api={applySettings,readStatus,restoreBackup};');
const warp=load('lid-tengoku-warp-tool','lid-tengoku-warp.js','\nisGameRunning=()=>false;globalThis.api={setPatchState,readStatus};');
const m2g=require('../../lid-m2g-knife-only/tool');
const helpers=['lid-justguard-tool','lid-tengoku-warp-tool','lid-m2g-knife-only','lid-vending-enhancement'].map(r=>require(path.join(workspace,r,'shared/layers')));
for(const s of helpers){const original=s.transact;s.transact=(g,k,f,o={})=>original(g,k,f,{...o,checkRunning:()=>false});}
const shared=helpers[0],vending=helpers[3];
const files=shared.FILES,sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const baseline=files.map((f,i)=>i===5?Buffer.from('DB retained unchanged'):fs.readFileSync(path.join(source,f)));
const baselineHashes=baseline.map(sha);
function permutations(a){if(!a.length)return [[]];return a.flatMap((x,i)=>permutations(a.filter((_,j)=>j!==i)).map(p=>[x,...p]));}
function gaps(b){const entries=[];for(let i=0;i<b.readUInt32LE(0x71);i++){const at=0x75+i*16;entries.push([b.readUInt32LE(at+8),b.readUInt32LE(at+12)]);}entries.sort((a,b)=>a[0]-b[0]);for(let i=1;i<entries.length;i++)assert.equal(entries[i][0],entries[i-1][0]+entries[i-1][1]);assert.equal(entries.at(-1)[0]+entries.at(-1)[1],b.length);}
function capture(game){return files.map(f=>fs.readFileSync(path.join(game,f)));}
function check(game,recognize=false){const b=capture(game);gaps(b[1]);gaps(b[2]);require('../shared/kernel/src/executable-links').validatePackageLinks(b[0],game);assert.equal(sha(b[5]),baselineHashes[5]);if(recognize){guard.readStatus(game);warp.readStatus(game);m2g.inspectStatus(m2g.readPair(game));}}
function vendingChange(game,enabled){return vending.transact(game,'vending',stage=>{
 if(!enabled)return {vending:null};
 const base=[0,1].map(i=>fs.readFileSync(path.join(stage,files[i]))),config={language:'en',decals:true,ammo:true,rows:[]},output=vending.compose(base,config);
 output.forEach((b,i)=>fs.writeFileSync(path.join(stage,files[i]),b));return {vending:{base,config}};
},{checkRunning:()=>false});}
const results=[];let expected;
const allOrders=permutations(['G','W','M','V']),orders=limit===4?[0,23,12,6].map(i=>allOrders[i]):allOrders.slice(0,limit);
for(const order of orders){
 const game=path.join(root,order.join(''),'game');baseline.forEach((b,i)=>{const f=path.join(game,files[i]);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b);});
 const initial=guard.applySettings(game,'soft','on','on');const beforeLayout=capture(game).map(sha);
 const compact=shared.compactPackages(game,{checkRunning:()=>false});assert.equal(compact.changed,true);check(game);
 const initialCompact=capture(game).map(sha);
 const operations={G:()=>guard.applySettings(game,'wide','off','on'),W:()=>warp.setPatchState(game,true,true),M:()=>m2g.apply(game,path.join(root,'unused'),{running:()=>false}),V:()=>vendingChange(game,true)};
 const removals={G:()=>guard.applySettings(game,'soft','on','on'),W:()=>warp.setPatchState(game,false,true),M:()=>m2g.remove(game,path.join(root,'unused'),{running:()=>false}),V:()=>vendingChange(game,false)};
 for(const key of order){operations[key]();check(game);console.log(order.join(''),key,'apply: contiguous, hash-linked');}
 check(game,true);
 const final=capture(game).map(sha);if(expected)assert.deepEqual(final,expected);else expected=final;
 for(const key of order){const before=capture(game).map(sha);operations[key]();assert.deepEqual(capture(game).map(sha),before);}
 for(const key of [...order].reverse()){removals[key]();check(game);}
 assert.deepEqual(capture(game).map(sha),initialCompact);
 shared.restore(game,compact.backup,{checkRunning:()=>false});assert.deepEqual(capture(game).map(sha),beforeLayout);
 guard.restoreBackup(game,initial.backupPath);assert.deepEqual(capture(game).map(sha),baselineHashes);
 results.push({order:order.join(''),apply:true,reapply:true,reverseRemoval:true,layoutRestore:true});
 console.log('PASS',order.join(''));
}
for(let i=0;i<5;i++)assert.equal(sha(fs.readFileSync(path.join(source,files[i]))),baselineHashes[i]);
console.log(JSON.stringify({sourceUnchanged:true,results,evidence:root}));
