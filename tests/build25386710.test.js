'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const repo=path.resolve(__dirname,'..'),m=require('../assets/manifest-25386710.json');
test('25386710 manifest includes standalone strengths and runtime combinations',()=>{
  assert.equal(m.common.profiles.stock.sha1,'2E34F1F72B14B7D18AC701D87FFEBD14A63C94E4');
  assert.equal(m.groggy.profiles['off-off'].sha1,'C1C9738885B6672F61026A3767EAD65A08D7CD51');
  assert.equal(m.common.profiles.soft.duration,0.5);
  assert.equal(Object.keys(m.common.profiles).length,4);
  assert.equal(Object.keys(m.groggy.profiles).length,4);
  for(const p of [...Object.values(m.common.profiles),...Object.values(m.groggy.profiles)])
    assert.equal(fs.readFileSync(path.join(repo,'assets',p.patch)).subarray(0,8).toString(),'LIDXOR1\0');
});
test('25386710 real copies: all 16 combinations, transitions and exact restore', {skip:!process.env.LID_GUARD_25386710_GAME},()=>{
  const source=process.env.LID_GUARD_25386710_GAME;
  const parent=path.join(repo,'.integration-temp');fs.mkdirSync(parent,{recursive:true});
  const temp=fs.mkdtempSync(path.join(parent,'guard25386710-test-'));
  const game=path.join(temp,'game'),backup=path.join(temp,'backups');
  const files=[m.common.relativePath,m.groggy.relativePath,m.executable.relativePath,
    'BrgGame/CookedPCConsole/Heaven_A01_ST_COL.upk','BrgGame/CookedPCConsole/BrgStart_PL.upk'];
  const digest=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const initial={};
  for(const rel of files){const f=path.join(game,rel);fs.mkdirSync(path.dirname(f),{recursive:true});fs.copyFileSync(path.join(source,rel),f);initial[rel]=digest(f);}
  const script=path.join(repo,'lid-justguard.js');
  const ctx=vm.createContext({require:createRequire(script),__dirname:repo,Buffer,console,process,backup});
  vm.runInContext(fs.readFileSync(script,'utf8').split('main().catch(')[0]+'\nisGameRunning=()=>false;backupRoot=()=>backup;globalThis.api={readStatus,applySettings,restoreBackup};',ctx);
  const a=ctx.api;
  assert.equal(a.readStatus(game).common.profile,'stock');
  for(const strength of ['soft','wide','iron','stock'])for(const [groggy,melee] of [['on','on'],['off','on'],['on','off'],['off','off']]){
    const result=a.applySettings(game,strength,groggy,melee);
    const status=a.readStatus(game);
    assert.equal(status.common.profile,strength);assert.equal(status.groggy.profile,groggy+'-'+melee);
    assert.ok(Object.values(status.executable).every(x=>x.valid));
    assert.equal(a.applySettings(game,strength,groggy,melee).changed,false);
    if(result.changed)a.restoreBackup(game,result.backupPath);
    for(const rel of files)assert.equal(digest(path.join(game,rel)),initial[rel],rel);
    // Remove only this test's generated backup folder after verified restoration.
    assert.equal(path.dirname(backup),temp);fs.rmSync(backup,{recursive:true,force:true});
    console.log('Verified',strength,groggy,melee);
  }
  for(const rel of files)assert.equal(digest(path.join(source,rel)),initial[rel],'Live source changed: '+rel);
  console.log('Evidence copy:',temp);
});
