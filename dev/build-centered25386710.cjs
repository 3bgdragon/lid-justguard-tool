'use strict';
// Build reproducible XOR assets from verified, read-only stock input.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), warp = path.resolve(process.argv[3]);
const gm = require('../assets/manifest-25386710.json'), wm = require(path.join(warp, 'assets/manifest-25386710.json'));
const stock = fs.readFileSync(path.resolve(process.argv[2]));
const sha = bytes => crypto.createHash('sha1').update(bytes).digest('hex').toUpperCase();
assert.equal(sha(stock), gm.groggy.profiles['off-off'].sha1);
function read(file, kind) {
  const bytes = fs.readFileSync(file), isWarp = kind === 'warp';
  assert.equal(bytes.subarray(0, 8).toString(), isWarp ? 'LIDBIN1\0' : 'LIDXOR1\0');
  const entries = []; let at = isWarp ? 16 : 12;
  const count = bytes.readUInt32LE(isWarp ? 12 : 8);
  for (let i = 0; i < count; i++) {
    const offset = bytes.readUInt32LE(at), size = bytes.readUInt32LE(at + 4); at += 8;
    entries.push({ offset, payload: bytes.subarray(at, at + size) }); at += size;
  }
  assert.equal(at, bytes.length);
  return { entries, targetSize: isWarp ? bytes.readUInt32LE(8) : null };
}
for (const name of ['off-off', 'off-on', 'on-off', 'on-on']) {
  const profile = gm.groggy.profiles[name], sourceDelta = read(path.join(root, 'assets', profile.patch));
  const standalone = Buffer.alloc(profile.size); stock.copy(standalone);
  for (const { offset, payload } of sourceDelta.entries) for (let i = 0; i < payload.length; i++) standalone[offset + i] ^= payload[i];
  assert.equal(sha(standalone), profile.sha1);
  const warpDelta = read(path.join(warp, 'assets', wm.brgGame.profiles[name].enablePatch), 'warp');
  const centered = Buffer.alloc(warpDelta.targetSize); standalone.copy(centered);
  for (const { offset, payload } of warpDelta.entries) payload.copy(centered, offset);
  assert.equal(sha(centered), wm.brgGame.profiles[name].patchedSha1);
  const ranges = [...sourceDelta.entries, ...warpDelta.entries].map(e => [e.offset, e.offset + e.payload.length]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const chunks = [], reconstructed = Buffer.alloc(centered.length); stock.copy(reconstructed);
  for (const [start, end] of merged) {
    const payload = Buffer.alloc(end - start);
    for (let i = start; i < end; i++) payload[i - start] = (stock[i] || 0) ^ (centered[i] || 0);
    const header = Buffer.alloc(8); header.writeUInt32LE(start); header.writeUInt32LE(payload.length, 4);
    chunks.push(header, payload);
    for (let i = start; i < end; i++) reconstructed[i] ^= payload[i - start];
  }
  assert.deepEqual(reconstructed, centered);
  const header = Buffer.alloc(12); header.write('LIDXOR1\0'); header.writeUInt32LE(merged.length, 8);
  const bytes = Buffer.concat([header, ...chunks]), patchName = `25386710-groggy-${name}-centered.lidxor`;
  const target = path.join(root, 'assets', patchName);
  if (fs.existsSync(target)) assert.deepEqual(fs.readFileSync(target), bytes);
  else fs.writeFileSync(target, bytes, { flag: 'wx' });
  gm.groggy.profiles[name + '-centered'] = { ...profile, sha1: sha(centered), patch: patchName, size: centered.length, warpCentered: true };
}
const file = path.join(root, 'assets/manifest-25386710.json');
const old = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd(), next = JSON.stringify(gm, null, 2);
process.stdout.write('*** Begin Patch\n*** Update File: ' + file.replace(/\\/g, '/') + '\n@@\n' + old.split('\n').map(s => '-' + s).join('\n') + '\n' + next.split('\n').map(s => '+' + s).join('\n') + '\n*** End Patch\n');
