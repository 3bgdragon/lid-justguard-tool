'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
test('guard relinking preserves all non-link bytes and rejects mismatched links',()=>{
 const root=path.resolve(__dirname,'..'),script=path.join(root,'lid-justguard.js'),ctx=vm.createContext({require:createRequire(script),__dirname:root,Buffer,process,console});
 vm.runInContext(fs.readFileSync(script,'utf8').split('main().catch(')[0]+'\nmanifest=require("./assets/manifest-25386710.json");globalThis.api={inspectExecutable,makeExecutableTemp};',ctx);
 const common='AA'.repeat(20),groggy='BB'.repeat(20),bytes=Buffer.concat([Buffer.from('MZ-foreign-native-code'),Buffer.from('as_ch_main_male_common_sf.upk\0'),Buffer.from(common,'hex'),...Array.from({length:2},()=>Buffer.concat([Buffer.from('brggame.upk\0'),Buffer.from(groggy,'hex')])),Buffer.from('foreign-tail')]);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lid-guard-exe-'));try{
 const source=path.join(temp,'source.exe'),on=path.join(temp,'on.exe'),off=path.join(temp,'off.exe');fs.writeFileSync(source,bytes);
 assert.ok(Object.values(ctx.api.inspectExecutable(source,common,groggy)).every(e=>e.valid));
 ctx.api.makeExecutableTemp(source,'CC'.repeat(20),'DD'.repeat(20),on);
 ctx.api.makeExecutableTemp(on,common,groggy,off);assert.deepEqual(fs.readFileSync(off),bytes);
 assert.ok(Object.values(ctx.api.inspectExecutable(source,'CC'.repeat(20),groggy)).some(e=>!e.valid));
 assert.deepEqual(fs.readFileSync(source),bytes);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
