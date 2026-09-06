const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const manifest = require('../assets/manifest.json');
test('latest profiles carry branch repair and exact old migration deltas', () => {
  for (const key of ['on-on', 'off-on']) {
    const p = manifest.groggy.profiles[key];
    const old = manifest.groggy.profiles[key + '-v1.4.1'];
    assert.equal(p.guardStateBranchFixed, true);
    assert.ok(p.size > p.xorBaseSize);
    assert.notEqual(p.patch, old.patch);
    assert.ok(fs.existsSync(path.resolve(__dirname, '../assets', old.patch)));
  }
});
test('real old ON -> fixed ON -> fixed OFF -> old ON roundtrip without stock bak',
  { skip: !process.env.LID_GUARD_TEST_SOURCE }, () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../lid-justguard.js'), 'utf8');
    const hash = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').toUpperCase();
    const context = vm.createContext({fs,path,Buffer,ASSET_DIRECTORY:path.resolve(__dirname,'../assets'),
      PATCH_MAGIC:Buffer.from('LIDXOR1\0'), STOCK_HASHES:{},sha1File:hash,
      fail:(message)=>{throw new Error(message);}});
    vm.runInContext(source.slice(source.indexOf('function readPatch('),source.indexOf('function makeExecutableTemp(')),context);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'lid-guard-roundtrip-'));
    const profiles = manifest.groggy.profiles;
    try {
      let input = process.env.LID_GUARD_TEST_SOURCE;
      let current = profiles['on-on-v1.4.1'];
      assert.equal(hash(input),current.sha1);
      for (const key of ['on-on','off-on','on-on-v1.4.1']) {
        const output = path.join(dir,key+'.upk');
        context.makePatchedTemp(input,current,profiles[key],manifest.groggy.size,output);
        assert.equal(hash(output),profiles[key].sha1);
        input=output; current=profiles[key];
      }
    } finally {
      assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));
      assert.ok(path.basename(dir).startsWith('lid-guard-roundtrip-'));
      fs.rmSync(dir,{recursive:true,force:true});
    }
  });
