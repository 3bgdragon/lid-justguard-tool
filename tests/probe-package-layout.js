'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {compact}=require('../shared/package-layout');
const repo=path.resolve(__dirname,'..'),manifest=require('../assets/manifest-25386710.json'),source=path.resolve(process.argv[2]);
const root=fs.mkdtempSync(path.join(repo,'.integration-temp/editor-layout-'));
for(const [type,name] of [['common','soft'],['groggy','on-on']]){
 const item=manifest[type],profile=item.profiles[name],original=fs.readFileSync(path.join(source,item.relativePath)),legacy=Buffer.alloc(profile.size||original.length);original.copy(legacy);
 const delta=fs.readFileSync(path.join(repo,'assets',profile.patch));let at=12;
 for(let i=0;i<delta.readUInt32LE(8);i++){const offset=delta.readUInt32LE(at),length=delta.readUInt32LE(at+4);at+=8;for(let j=0;j<length;j++)legacy[offset+j]^=delta[at+j];at+=length;}
 assert.equal(crypto.createHash('sha1').update(legacy).digest('hex').toUpperCase(),profile.sha1);
 fs.writeFileSync(path.join(root,type+'-legacy.upk'),legacy);fs.writeFileSync(path.join(root,type+'-compact.upk'),compact(legacy));
}
console.log(root);
