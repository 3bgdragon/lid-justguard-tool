'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { configure, text } = require('../language');
const directory = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(directory, 'lid-justguard.js'), 'utf8');
test('English status preserves guard values, file paths and hashes', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'assets/manifest.json'), 'utf8'));
  const fragment = source.slice(source.indexOf('function strengthDisplay('), source.indexOf('\nfunction ', source.indexOf('function printStatus(') + 1));
  configure(['--lang', 'en'], directory);
  try {
    const lines = [];
    const context = vm.createContext({ t: text, manifest, executableIsValid: () => true, console: { log: line => lines.push(line) } });
    vm.runInContext(fragment, context);
    context.printStatus({ gameDirectory: 'C:/한글 경로', common: { profile: 'soft' }, groggy: { profile: null, hash: 'ABC0123' } });
    const output = lines.join('\n');
    assert.doesNotMatch(output.replace('C:/한글 경로', ''), /[가-힣]/);
    assert.match(output, /Relaxed/);
    assert.ok(output.includes(manifest.common.profiles.soft.duration.toFixed(3) + 's'));
    assert.match(output, /ABC0123/);
  } finally { configure(['--lang', 'ko'], directory); }
});
test('English strength menu leaves profile data unchanged', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'assets/manifest.json'), 'utf8'));
  const before = JSON.stringify(manifest);
  const fragment = source.slice(source.indexOf('function printStrengthChoices('), source.indexOf('\nasync function interactive('));
  configure(['--lang', 'en'], directory);
  try {
    const lines = [];
    const context = vm.createContext({ t: text, manifest, STRENGTH_ORDER: ['stock', 'soft', 'wide', 'iron'], strengthDisplay: name => name, console: { log: line => lines.push(line) } });
    vm.runInContext(fragment, context);
    context.printStrengthChoices();
    assert.doesNotMatch(lines.join('\n'), /[가-힣]/);
    assert.equal(JSON.stringify(manifest), before);
  } finally { configure(['--lang', 'ko'], directory); }
});
