const { test } = require('node:test');
const assert = require('node:assert/strict');
const { repairBuffer, repairExecutable, patch } = require('../guard-state-repair');
test('reject unknown packages without mutation', () => {
  const input = Buffer.from('unsupported');
  assert.throws(() => repairBuffer(input), /지원/);
  assert.equal(input.toString(), 'unsupported');
});
test('update only two BrgGame digests, preserving native and animation changes', () => {
  const old = '11'.repeat(20), next = '22'.repeat(20);
  const item = Buffer.concat([Buffer.from('brggame.upk\0'), Buffer.from(old, 'hex')]);
  const source = Buffer.concat([Buffer.from('native-custom'), item, Buffer.from('animation-custom'), item]);
  const target = repairExecutable(source, old, next);
  assert.equal(target.length, source.length);
  assert.equal(target.subarray(0,13).toString(), 'native-custom');
  assert(target.includes(Buffer.from('animation-custom')));
  assert(source.includes(Buffer.from(old, 'hex')));
  assert.throws(() => repairExecutable(source, next, old), /다릅니다/);
  assert.throws(() => repairExecutable(item, old, next), /항목 수/);
});
test('branch lands at next condition in 64-bit script, not serialized argument', () => {
  assert.equal(patch.logicalChange.before, 0x17);
  assert.equal(patch.logicalChange.after, 0x1b);
  assert.equal(patch.logicalChange.function, 'BrgPawn_Base.IsCanGuardState');
});
