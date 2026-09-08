const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const m=require('../assets/manifest-25136512.json');
test('new build includes all guard settings and warp-preserving counterparts',()=>{
 assert.equal(m.steamBuildId,'25136512');
 for(const g of ['off','on']) for(const melee of ['off','on']){
  const key=g+'-'+melee,p=m.groggy.profiles[key],center=m.groggy.profiles[key+'-centered'];
  assert.equal(p.groggy,g);assert.equal(p.meleeGuard,melee);
  assert.equal(center.warpCentered,true);assert.equal(center.xorBaseSize,p.xorBaseSize);
  assert.notEqual(center.sha1,p.sha1);
 }
 for(const p of [...Object.values(m.common.profiles),...Object.values(m.groggy.profiles)]){
  assert.ok(p.size>=p.xorBaseSize);
  const data=fs.readFileSync(path.resolve(__dirname,'../assets',p.patch));
  assert.equal(data.subarray(0,8).toString(),'LIDXOR1\0');
 }
});
