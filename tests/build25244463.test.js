'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const crypto = require('node:crypto');
const m = require('../assets/manifest-25244463.json');
test('25244463 includes four strengths and all warp-preserving guard profiles', () => {
  assert.equal(m.steamBuildId, '25244463');
  assert.equal(m.common.profiles.stock.sha1, '5124C1448EA936B06D041AF4CDFC8FD2EA69888D');
  assert.equal(m.groggy.profiles['off-off-centered'].sha1, 'F83CA59BDFA8232C7DAA0557536C4D5F6D49C909');
  assert.equal(Object.values(m.common.profiles).filter(p => !p.legacy).length, 4);
  assert.equal(m.common.profiles.soft.duration, 0.5);
  assert.equal(m.common.profiles['soft-085-legacy'].duration, 0.85);
  assert.equal(Object.keys(m.groggy.profiles).length, 8);
  for (const p of [...Object.values(m.common.profiles), ...Object.values(m.groggy.profiles)]) {
    assert.ok(p.size >= p.xorBaseSize);
    assert.equal(fs.readFileSync(path.resolve(__dirname, '../assets', p.patch)).subarray(0, 8).toString(), 'LIDXOR1\0');
  }
});

test('25244463 soft 0.85 -> 0.5 -> 0.85 -> stock exact package roundtrip', {
  skip: !process.env.LID_GUARD_25244463_GAME,
}, () => {
  const repo = path.resolve(__dirname, '..');
  const script = path.join(repo, 'lid-justguard.js');
  const context = { require: createRequire(script), __dirname: repo, Buffer, console, process };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(script, 'utf8').split('main().catch(')[0] +
    '\nglobalThis.patch = makePatchedTemp; globalThis.digest = sha1File;', context);
  const parent = path.join(repo, '.integration-temp');
  fs.mkdirSync(parent, { recursive: true });
  const temp = fs.mkdtempSync(path.join(parent, 'soft050-'));
  let source = path.join(temp, 'stock.upk');
  fs.copyFileSync(path.join(process.env.LID_GUARD_25244463_GAME, m.common.relativePath), source);
  assert.equal(context.digest(source), m.common.profiles.stock.sha1);
  let current = m.common.profiles.stock;
  for (const [i, key] of ['soft-085-legacy', 'soft', 'soft-085-legacy', 'stock'].entries()) {
    const target = m.common.profiles[key];
    const output = path.join(temp, `${i}.upk`);
    context.patch(source, current, target, m.common.size, output);
    assert.equal(context.digest(output), target.sha1);
    source = output; current = target;
  }
});

test('25244463 real copy: 32 settings, warp removal orders, exact restoration', {
  skip: !process.env.LID_GUARD_25244463_GAME || !process.env.LID_GUARD_25244463_WARP,
}, () => {
  const repo = path.resolve(__dirname, '..');
  const tempRoot = path.join(repo, '.integration-temp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const temp = fs.mkdtempSync(path.join(tempRoot, 'build25244463-'));
  const game = path.join(temp, 'game');
  const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const relatives = [m.common.relativePath, m.groggy.relativePath, m.executable.relativePath,
    'BrgGame/CookedPCConsole/Heaven_A01_ST_COL.upk', 'BrgGame/CookedPCConsole/BrgStart_PL.upk'];
  const source = process.env.LID_GUARD_25244463_GAME;
  const initial = {};
  for (const rel of relatives) {
    const file = path.join(game, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(source, rel), file);
    initial[rel] = hash(file);
  }
  function load(file, exports, backupName) {
    const context = { require: createRequire(file), __dirname: path.dirname(file), Buffer, console, process,
      backupDirectory: path.join(temp, backupName) };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(file, 'utf8').split('main().catch(')[0] +
      `\nisGameRunning = () => false; backupRoot = () => backupDirectory; globalThis.api = {${exports}};`, context);
    return context.api;
  }
  const guard = load(path.join(repo, 'lid-justguard.js'), 'readStatus, applySettings, restoreBackup', 'guard-backups');
  const warp = load(path.resolve(process.env.LID_GUARD_25244463_WARP, 'lid-tengoku-warp.js'), 'readStatus, setPatchState', 'warp-backups');
  const first = guard.readStatus(game);
  let initialBackup;
  for (const enabled of [false, true]) {
    warp.setPatchState(game, enabled, true);
    for (const strength of ['soft', 'wide', 'iron', 'stock']) {
      for (const [groggy, melee] of [['on','on'], ['off','on'], ['on','off'], ['off','off']]) {
        const unchanged = relatives.slice(3).map(rel => hash(path.join(game, rel)));
        const result = guard.applySettings(game, strength, groggy, melee);
        initialBackup ||= result.backupPath;
        const status = guard.readStatus(game);
        assert.equal(status.common.profile, strength);
        assert.equal(status.groggy.profile, groggy + '-' + melee + (enabled ? '-centered' : ''));
        assert.ok(Object.values(status.executable).every(x => x.valid));
        const ws = warp.readStatus(game);
        assert.equal(ws.coherent, true);
        assert.equal(ws.brgGame.enabled, enabled);
        assert.deepEqual(relatives.slice(3).map(rel => hash(path.join(game, rel))), unchanged);
      }
      console.log(`25244463 verified warp=${enabled} strength=${strength} all 4 runtime combinations`);
    }
  }
  // Remove warp with guard still enabled, then restore guard and re-enable
  // warp; both tools must recognize the other's outputs in either order.
  guard.applySettings(game, 'iron', 'on', 'on');
  warp.setPatchState(game, false, true);
  assert.equal(guard.readStatus(game).groggy.profile, 'on-on');
  guard.applySettings(game, 'stock', 'off', 'off');
  warp.setPatchState(game, true, true);
  assert.equal(guard.readStatus(game).groggy.profile, 'off-off-centered');
  // Restore the original captured state via each tool's normal operations.
  warp.setPatchState(game, false, true);
  guard.restoreBackup(game, initialBackup);
  if (first.groggy.profile.endsWith('-centered')) warp.setPatchState(game, true, true);
  for (const rel of relatives) {
    assert.equal(hash(path.join(game, rel)), initial[rel], rel);
    assert.equal(hash(path.join(source, rel)), initial[rel], 'Live source changed: ' + rel);
  }
  console.log('Exact copy/source hashes verified. Evidence: ' + temp);
});
