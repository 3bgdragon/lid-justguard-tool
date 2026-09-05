'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const patch = require('./assets/guard-state-repair.json');
const hash = (data) => crypto.createHash('sha1').update(data).digest('hex').toUpperCase();

function repairBuffer(source) {
  if (hash(source) === patch.fixedSha1) return Buffer.from(source);
  if (hash(source) !== patch.baseSha1 || source.length !== patch.sourceSize) {
    throw new Error('이 가드 오류 수정은 확인된 2026-09-05 사용자 수정본만 지원합니다. 다른 파일은 변경하지 않습니다.');
  }
  const target = Buffer.alloc(patch.targetSize);
  source.copy(target);
  for (const entry of patch.entries) {
    const data = Buffer.from(entry.data, 'base64');
    if (entry.offset < 0 || entry.offset + data.length > target.length) throw new Error('패치 범위 오류');
    data.copy(target, entry.offset);
  }
  if (hash(target) !== patch.fixedSha1) throw new Error('수정 파일 해시 검증 실패');
  return target;
}

function repairExecutable(source, oldHash, newHash) {
  const out = Buffer.from(source);
  const needle = Buffer.from('brggame.upk\0');
  let cursor = 0, count = 0;
  for (;;) {
    const at = out.indexOf(needle, cursor);
    if (at < 0) break;
    const offset = at + needle.length;
    if (out.subarray(offset, offset + 20).toString('hex').toUpperCase() !== oldHash) {
      throw new Error('실행 파일의 BrgGame 해시가 현재 패키지와 다릅니다.');
    }
    Buffer.from(newHash, 'hex').copy(out, offset);
    cursor = offset + 20;
    count++;
  }
  if (count !== 2) throw new Error('실행 파일 해시 항목 수가 예상과 다릅니다.');
  return out;
}

function repair(game, backupRoot) {
  const upkPath = path.join(game, 'BrgGame/CookedPCConsole/BrgGame.upk');
  const exePath = path.join(game, 'Binaries/Win64/BrgGame-Steam.exe');
  const source = fs.readFileSync(upkPath), exe = fs.readFileSync(exePath);
  const fixed = repairBuffer(source);
  const updatedExe = repairExecutable(exe, hash(source), hash(fixed));
  if (hash(source) === hash(fixed)) return { changed: false };
  const folder = path.join(backupRoot, `guard-repair-${Date.now()}`);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'BrgGame.upk'), source, { flag: 'wx' });
  fs.writeFileSync(path.join(folder, 'BrgGame-Steam.exe'), exe, { flag: 'wx' });
  // Standard backup metadata permits the existing explicit restore command.
  const commonPath = path.join(game, 'BrgGame/CookedPCConsole/AS_CH_Main_Male_Common_SF.upk');
  const common = fs.readFileSync(commonPath);
  fs.writeFileSync(path.join(folder, path.basename(commonPath)), common, { flag: 'wx' });
  const files = {};
  for (const [key, name, data] of [['common', path.basename(commonPath), common], ['groggy', 'BrgGame.upk', source], ['executable', 'BrgGame-Steam.exe', exe]]) {
    files[key] = { name, size: data.length, sha1: hash(data) };
  }
  fs.writeFileSync(path.join(folder, 'backup.json'), JSON.stringify({ format: 1, createdAt: new Date().toISOString(), reason: 'repair-guard-state', gameDirectory: game, files }, null, 2), { flag: 'wx' });
  const replacements = [[upkPath, fixed], [exePath, updatedExe]];
  for (const [file] of replacements) {
    if (fs.existsSync(file + '.guard-repair.tmp')) throw new Error('이전 임시 파일이 남아 있습니다.');
  }
  try {
    for (const [file, data] of replacements) {
      fs.writeFileSync(file + '.guard-repair.tmp', data, { flag: 'wx' });
      if (hash(fs.readFileSync(file + '.guard-repair.tmp')) !== hash(data)) throw new Error('임시 파일 검증 실패');
    }
    for (const [file] of replacements) fs.renameSync(file + '.guard-repair.tmp', file);
  } catch (error) {
    fs.copyFileSync(path.join(folder, 'BrgGame.upk'), upkPath);
    fs.copyFileSync(path.join(folder, 'BrgGame-Steam.exe'), exePath);
    throw error;
  } finally {
    for (const [file] of replacements) if (fs.existsSync(file + '.guard-repair.tmp')) fs.unlinkSync(file + '.guard-repair.tmp');
  }
  return { changed: true, backupPath: folder };
}
module.exports = { repair, repairBuffer, repairExecutable, hash, patch };
