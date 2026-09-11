'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const embedded = require('../compat/m2g/embedded');
const engine = require('../compat/m2g/package-patch');

test('unknown packages remain rejected', () => {
  assert.equal(embedded.identify(Buffer.from('unknown')), null);
  assert.throws(() => embedded.set(Buffer.from('unknown'), true));
});

test('reported pristine hash: all eight guard/warp targets preserve M2G off', {
  skip: !process.env.LID_252_EMBEDDED_BASE,
}, () => {
  const base = fs.readFileSync(process.env.LID_252_EMBEDDED_BASE);
  const table = engine.entries(base);
  const clean = Buffer.from(base.subarray(0, table[0][2]));
  for (const [i, pos] of [[0, 0x3129], [285, table[284][2] + table[284][3]]]) {
    const size = base.readUInt32LE(pos + 12);
    const packed = 16 + 8 * Math.ceil(size / base.readUInt32LE(pos + 4)) + base.readUInt32LE(pos + 8);
    const entry = [table[i][0], size, pos, packed];
    engine.unpack(base, entry);
    entry.forEach((v, k) => clean.writeUInt32LE(v, 117 + i * 16 + k * 4));
  }
  assert.equal(crypto.createHash('sha1').update(clean).digest('hex'), '99e2a2ee23b4638e5e5d25ded5db21777b41406a');
  assert.equal(embedded.identify(clean).pristine, true);
  assert.deepEqual(embedded.set(clean, false), clean);
  assert.deepEqual(embedded.set(clean, true), base);
  const changed = Buffer.from(clean); changed[10000] ^= 1;
  assert.equal(embedded.identify(changed), null);
  const root = path.resolve(__dirname, '..');
  const script = path.join(root, 'lid-justguard.js');
  const context = {require:createRequire(script), __dirname:root, Buffer, console, process};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(script, 'utf8').split('main().catch(')[0] + '\nmanifest = JSON.parse(fs.readFileSync(path.join(ASSET_DIRECTORY,"manifest-25244463.json"))); globalThis.api={makeEmbeddedTemp,identifyProfile,manifest};', context);
  const tempRoot = path.join(root, '.integration-temp'); fs.mkdirSync(tempRoot, {recursive:true});
  const dir = fs.mkdtempSync(path.join(tempRoot, 'pristine-'));
  const input = path.join(dir, 'clean.upk'); fs.writeFileSync(input, clean);
  const profiles = context.api.manifest.groggy.profiles;
  const status = context.api.identifyProfile(input, context.api.manifest.groggy);
  assert.equal(status.profile, 'off-off'); assert.equal(status.m2g, false);
  for (const [name, target] of Object.entries(profiles)) {
    const output = path.join(dir, name + '.upk');
    context.api.makeEmbeddedTemp(input, profiles['off-off'], target, output, false);
    const result = fs.readFileSync(output);
    assert.equal(embedded.identify(result).enabled, false);
    const exp = engine.readAt(result, engine.entries(result), engine.EXPORT_SLOT + 32, 8).data;
    assert.equal(exp.readUInt32LE(0), engine.PLAY_SIZE);
    assert.equal(exp.readUInt32LE(4), engine.PLAY_OFFSET);
    fs.unlinkSync(output);
  }
  fs.unlinkSync(input); fs.rmdirSync(dir);
});
