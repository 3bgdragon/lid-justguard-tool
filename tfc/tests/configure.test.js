'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const api=require('../configure');
test('reviewed 4 timing x 2 groggy x 2 melee configurations generate isolated native patches',t=>{
 const parent=path.resolve(__dirname,'../.integration-temp');fs.mkdirSync(parent,{recursive:true});
 const root=fs.mkdtempSync(path.join(parent,'configuration-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const strength of Object.keys(api.STRENGTHS))for(const groggy of [false,true])for(const melee of [false,true]){
  const config={strength,groggy,melee,elemental:melee};
  if(strength==='stock'&&!groggy&&!melee){assert.throws(()=>api.generate(config,root),/All stock/);continue;}
  const result=api.generate(config,root),dir=path.join(result.output,'Game/BrgGame/CookedPCConsole');
  assert(fs.existsSync(path.join(result.output,'run-tfc.bat')));assert(!fs.existsSync(path.join(result.output,'run.bat')));
  assert.equal(fs.existsSync(path.join(dir,'AS_CH_Main_Male_Common_SF.PackagePatch')),strength!=='stock');
  assert.equal(fs.existsSync(path.join(dir,'BrgGame.PackagePatch')),groggy||melee);
  assert(!fs.existsSync(path.join(result.output,'Game/Binaries')));assert(!fs.existsSync(path.join(result.output,'Game/BrgGame/Content')));
  const settings=JSON.parse(fs.readFileSync(path.join(result.output,'settings.json')));
  assert.equal(settings.timing.duration,api.STRENGTHS[strength].duration);
  assert.equal(settings.elemental,melee);assert.equal(settings.elementalIndependent,false);
  assert.equal(typeof require(path.join(result.output,'runtime/tfc-companion')).change,'function');
 }
});
test('unverified independent elemental states and invalid settings fail before any output write',()=>{
 for(const melee of [false,true])assert.throws(()=>api.validate({strength:'soft',groggy:true,melee,elemental:!melee}),/not verified/);
 assert.throws(()=>api.validate({strength:'bad',groggy:true,melee:true,elemental:true}),/Invalid/);
});
