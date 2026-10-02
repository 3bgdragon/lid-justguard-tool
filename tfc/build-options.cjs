'use strict';
// Developer-only builder. Reads reviewed stock files; never edits a game.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const repo=path.resolve(__dirname,'..'),manifest=require('../assets/manifest-25386710.json');
const source=path.resolve(process.argv[2]||''),library=path.resolve(process.argv[3]||'');
if(!process.argv[2]||!process.argv[3])throw Error('Usage: node tfc/build-options.cjs STOCK_GAME_COPY UPK_LIBRARY');
const stage=fs.mkdtempSync(path.join(repo,'.integration-temp/tfc-options-'));
const hash=b=>crypto.createHash('sha1').update(b).digest('hex').toUpperCase();
for(const [kind,baseKey,profiles] of [['common','stock',['soft','wide','iron']],['groggy','off-off',['off-on','on-off','on-on']]]){
 const spec=manifest[kind],base=fs.readFileSync(path.join(source,spec.relativePath));
 if(hash(base)!==spec.profiles[baseKey].sha1)throw Error('Stock package mismatch: '+kind);
 for(const name of profiles){
  const p=spec.profiles[name],data=fs.readFileSync(path.join(repo,'assets',p.patch));
  if(data.subarray(0,8).toString('ascii')!=='LIDXOR1\0')throw Error('Delta magic');
  const target=Buffer.alloc(p.size);base.copy(target);let at=12;
  for(let n=0;n<data.readUInt32LE(8);n++){
   const offset=data.readUInt32LE(at),length=data.readUInt32LE(at+4);at+=8;
   if(at+length>data.length||offset+length>target.length)throw Error('Delta bounds');
   for(let i=0;i<length;i++)target[offset+i]^=data[at+i];at+=length;
  }
  if(at!==data.length||hash(target)!==p.sha1)throw Error('Delta verification');
  const folder=path.join(stage,kind+'-'+name);fs.mkdirSync(folder);
  const input=path.join(folder,path.basename(spec.relativePath));fs.writeFileSync(input,require('./build-layout.cjs').compact(target));
  const output=path.join(__dirname,'options',kind+'-'+name+'.PackagePatch');
  cp.execFileSync('pwsh',['-NoProfile','-File',path.join(__dirname,'export-package.ps1'),'-Baseline',path.join(source,spec.relativePath),'-Modified',input,'-Output',output,'-Library',library],{stdio:'inherit'});
 }
}
console.log('Generated reviewed native TFC option patches; stock settings omit their corresponding patch.');
