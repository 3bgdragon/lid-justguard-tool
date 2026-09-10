'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const compat = require('../compat/m2g');
const { profiles } = require('../compat/m2g/profiles.json');
const manifest = require('../assets/manifest-25136512.json');

test('reported M2G + warp hash maps to stock guard with centered warp', () => {
  const p = compat.identify('2F408219CE541219B8BB5E6D063919755C2A915A');
  assert.equal(p.baseSha1, manifest.groggy.profiles['off-off-centered'].sha1);
});

test('all 16 Node/legacy combinations resolve to supported guard profiles', () => {
  assert.equal(profiles.length, 16);
  for (const p of profiles) {
    const key = p.guard + (p.warp ? '-centered' : '');
    assert.equal(p.baseSha1, manifest.groggy.profiles[key].sha1);
    assert.equal(!!compat.forBase(p.baseSha1).legacy, false);
  }
  assert.equal(compat.identify('unknown'), null);
  assert.throws(() => compat.strip(Buffer.from('unsupported package')));
});

// Optional real-package test: fixture directory contains the eight pre-M2G
// <off|on>-<off|on>-<no-warp|warp>.upk files. Legacy fixtures are optional.
test('real packages: every guard input preserves M2G and warp on transition', {
  skip: !process.env.LID_GUARD_M2G_FIXTURES,
}, () => {
  const root = path.resolve(__dirname, '..');
  const script = path.join(root, 'lid-justguard.js');
  const source = fs.readFileSync(script, 'utf8').split('main().catch(')[0];
  const context = {
    require: createRequire(script), __dirname: root, Buffer, console, process,
  };
  vm.createContext(context);
  vm.runInContext(source + '\nmanifest = JSON.parse(fs.readFileSync(path.join(ASSET_DIRECTORY, "manifest-25136512.json"))); globalThis.patchM2g = makeM2gPatchedTemp;', context);
  const temporaryRoot = path.join(root, '.integration-temp');
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(temporaryRoot, 'm2g-'));
  const input = path.join(temporary, 'input.upk');
  const output = path.join(temporary, 'output.upk');
  for (const p of profiles) {
    if (p.legacy && !process.env.LID_GUARD_LEGACY_M2G_FIXTURES) continue;
    const name = `${p.guard}-${p.warp ? 'warp' : 'no-warp'}.upk`;
    const fixtureRoot = p.legacy ? process.env.LID_GUARD_LEGACY_M2G_FIXTURES : process.env.LID_GUARD_M2G_FIXTURES;
    const fixture = fs.readFileSync(path.join(fixtureRoot, name));
    fs.writeFileSync(input, p.legacy ? fixture : compat.rebuild(fixture));
    const currentKey = p.guard + (p.warp ? '-centered' : '');
    const nextGuard = { 'off-off': 'on-on', 'on-on': 'off-off', 'on-off': 'off-on', 'off-on': 'on-off' }[p.guard];
    const targetKey = nextGuard + (p.warp ? '-centered' : '');
    const current = manifest.groggy.profiles[currentKey];
    const target = manifest.groggy.profiles[targetKey];
    const hash = context.patchM2g(input, current, target, output);
    assert.equal(hash, compat.forBase(target.sha1).sha1);
    const result = compat.strip(fs.readFileSync(output));
    assert.ok(result.equals(fs.readFileSync(path.join(process.env.LID_GUARD_M2G_FIXTURES, `${nextGuard}-${p.warp ? 'warp' : 'no-warp'}.upk`))));
    fs.unlinkSync(output);
    console.log(`verified ${p.legacy ? 'legacy' : 'node'} ${currentKey} -> ${targetKey}`);
  }
  fs.unlinkSync(input);
  fs.rmdirSync(temporary);
});

test('real apply/backup/restore preserves M2G, warp and executable code', {
  skip: !process.env.LID_GUARD_M2G_FIXTURES || !process.env.LID_GUARD_TEST_EXE || !process.env.LID_GUARD_TEST_COMMON,
}, () => {
  const root = path.resolve(__dirname, '..');
  const script = path.join(root, 'lid-justguard.js');
  const source = fs.readFileSync(script, 'utf8').split('main().catch(')[0];
  const temporaryRoot = path.join(root, '.integration-temp');
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(temporaryRoot, 'transaction-'));
  const context = { require: createRequire(script), __dirname: root, Buffer, console, process, temporary };
  vm.createContext(context);
  // Only process check and backup location are isolated; production mutation,
  // validation and transaction functions are used unchanged on copied files.
  vm.runInContext(source + `
    manifest = JSON.parse(fs.readFileSync(path.join(ASSET_DIRECTORY, 'manifest-25136512.json')));
    isGameRunning = () => false;
    backupRoot = () => path.join(temporary, 'backups');
    globalThis.api = { expectedPaths, makeExecutableTemp, readStatus, applySettings, restoreBackup, sha1File, executableIsValid };
  `, context);
  const api = context.api;
  const game = path.join(temporary, 'game');
  const files = api.expectedPaths(game);
  for (const file of Object.values(files)) fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(process.env.LID_GUARD_TEST_COMMON, files.common);
  const base = fs.readFileSync(path.join(process.env.LID_GUARD_M2G_FIXTURES, 'off-off-warp.upk'));
  fs.writeFileSync(files.groggy, compat.rebuild(base));
  api.makeExecutableTemp(process.env.LID_GUARD_TEST_EXE, api.sha1File(files.common), api.sha1File(files.groggy), files.executable);
  const initial = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, api.sha1File(file)]));
  const before = fs.readFileSync(files.executable);
  assert.equal(api.readStatus(game).groggy.profile, 'off-off-centered');
  const applied = api.applySettings(game, 'iron', 'on', 'on');
  assert.equal(applied.status.groggy.profile, 'on-on-centered');
  assert.equal(applied.status.groggy.m2g, true);
  assert.ok(api.executableIsValid(applied.status));
  const after = fs.readFileSync(files.executable);
  assert.equal(after.length, before.length);
  const expectedExe = path.join(temporary, 'expected.exe');
  const originalExe = path.join(temporary, 'original.exe');
  fs.writeFileSync(originalExe, before);
  api.makeExecutableTemp(originalExe, applied.status.common.hash, applied.status.groggy.hash, expectedExe);
  assert.ok(after.equals(fs.readFileSync(expectedExe)));
  assert.equal(api.applySettings(game, 'iron', 'on', 'on').changed, false);
  api.restoreBackup(game, applied.backupPath);
  for (const [key, file] of Object.entries(files)) assert.equal(api.sha1File(file), initial[key]);
  // Unknown UPK still has independently valid EXE linkage, but cannot apply.
  const handle = fs.openSync(files.groggy, 'r+');
  fs.writeSync(handle, Buffer.from([0]), 0, 1, 0);
  fs.closeSync(handle);
  const exeTemp = files.executable + '.test';
  api.makeExecutableTemp(files.executable, api.sha1File(files.common), api.sha1File(files.groggy), exeTemp);
  fs.copyFileSync(exeTemp, files.executable);
  const unknown = api.readStatus(game);
  assert.equal(unknown.groggy.profile, undefined);
  assert.ok(api.executableIsValid(unknown));
  const badHash = api.sha1File(files.groggy);
  assert.throws(() => api.applySettings(game, 'iron', 'on', 'on'));
  assert.equal(api.sha1File(files.groggy), badHash);
  console.log(`transaction evidence retained: ${temporary}`);
});
