#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const readline = require('readline/promises');

const PATCH_MAGIC = Buffer.from('LIDXOR1\0', 'ascii');
const ASSET_DIRECTORY = path.join(__dirname, 'assets');
const MANIFEST_PATH = path.join(ASSET_DIRECTORY, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

const STRENGTH_ORDER = ['stock', 'soft', 'wide', 'iron'];
const GROGGY_ORDER = ['off', 'on'];
const MELEE_GUARD_ORDER = ['off', 'on'];
const FILE_KEYS = ['common', 'groggy', 'executable'];

function fail(message) {
  const error = new Error(message);
  error.userFacing = true;
  throw error;
}

function timestamp() {
  const date = new Date();
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-` +
    pad(date.getMilliseconds(), 3);
}

function sha1File(filePath) {
  const digest = crypto.createHash('sha1');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
  return digest.digest('hex').toUpperCase();
}

function findSteamRoots() {
  const roots = new Set();
  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Steam'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Steam'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
  ].filter(Boolean);

  for (const steamRoot of candidates) {
    if (!fs.existsSync(steamRoot)) continue;
    roots.add(steamRoot);
    const libraryFile = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(libraryFile)) continue;
    const vdf = fs.readFileSync(libraryFile, 'utf8');
    for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
      roots.add(match[1].replace(/\\\\/g, '\\'));
    }
  }
  return [...roots];
}

function expectedPaths(gameDirectory) {
  return {
    common: path.join(gameDirectory, ...manifest.common.relativePath.split('/')),
    groggy: path.join(gameDirectory, ...manifest.groggy.relativePath.split('/')),
    executable: path.join(gameDirectory, ...manifest.executable.relativePath.split('/')),
  };
}

function isGameDirectory(gameDirectory) {
  const paths = expectedPaths(gameDirectory);
  return FILE_KEYS.every((key) => fs.existsSync(paths[key]));
}

function discoverGameDirectory(explicitPath) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!isGameDirectory(resolved)) fail(`LET IT DIE 설치 파일을 찾지 못했습니다: ${resolved}`);
    return resolved;
  }

  const matches = [];
  for (const root of findSteamRoots()) {
    const candidate = path.join(root, 'steamapps', 'common', 'LET IT DIE');
    if (isGameDirectory(candidate)) matches.push(candidate);
  }
  const unique = [...new Set(matches.map((item) => path.resolve(item)))];
  if (unique.length === 0) {
    fail('LET IT DIE 설치 폴더를 자동으로 찾지 못했습니다. --game "설치 경로"를 사용하세요.');
  }
  if (unique.length > 1) {
    fail(`LET IT DIE 설치 폴더가 여러 개입니다. --game으로 지정하세요:\n${unique.join('\n')}`);
  }
  return unique[0];
}

function isGameRunning() {
  if (process.platform !== 'win32') return false;
  try {
    const output = childProcess.execFileSync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return /BrgGame-Steam\.exe/i.test(output);
  } catch {
    return false;
  }
}

function identifyProfile(filePath, configuration) {
  const size = fs.statSync(filePath).size;
  const hash = sha1File(filePath);
  const profile = Object.entries(configuration.profiles)
    .find(([, value]) => value.sha1 === hash)?.[0];
  return { profile, hash, size, supportedSize: size === configuration.size };
}

function findRuntimeProfile(groggyName, meleeGuardName) {
  return Object.entries(manifest.groggy.profiles)
    .find(([, profile]) => profile.groggy === groggyName && profile.meleeGuard === meleeGuardName)?.[0];
}

function groggyLabel(name) {
  return name === 'on' ? 'ON (직접 공격자 Groggy)' : 'OFF (순정 Flip)';
}

function meleeGuardLabel(name) {
  return name === 'on'
    ? 'ON (근접무기 저스트가드 불가 제한 해제)'
    : 'OFF (순정 제한)';
}

function findAll(buffer, needle) {
  const positions = [];
  let cursor = 0;
  while (cursor <= buffer.length - needle.length) {
    const position = buffer.indexOf(needle, cursor);
    if (position < 0) break;
    positions.push(position);
    cursor = position + needle.length;
  }
  return positions;
}

function manifestDigestPositions(executable, assetName, expectedCount) {
  const needle = Buffer.from(`${assetName.toLowerCase()}\0`, 'ascii');
  const positions = findAll(executable, needle);
  if (positions.length !== expectedCount) {
    fail(`${assetName} 실행 파일 해시 항목이 ${expectedCount}개가 아닙니다: ${positions.length}개`);
  }
  return positions.map((position) => position + needle.length);
}

function inspectExecutable(executablePath, commonHash, groggyHash) {
  const executable = fs.readFileSync(executablePath);
  const results = {};
  const expected = {
    'as_ch_main_male_common_sf.upk': commonHash,
    'brggame.upk': groggyHash,
  };
  for (const [assetName, expectedCount] of Object.entries(manifest.executable.manifestEntries)) {
    const offsets = manifestDigestPositions(executable, assetName, expectedCount);
    const digests = offsets.map((offset) => executable.subarray(offset, offset + 20).toString('hex').toUpperCase());
    results[assetName] = { offsets, digests, valid: digests.every((value) => value === expected[assetName]) };
  }
  return results;
}

function readStatus(gameDirectory) {
  const paths = expectedPaths(gameDirectory);
  const common = identifyProfile(paths.common, manifest.common);
  const groggy = identifyProfile(paths.groggy, manifest.groggy);
  let executable;
  if (common.profile && groggy.profile) {
    executable = inspectExecutable(paths.executable, common.hash, groggy.hash);
  }
  return { gameDirectory, paths, common, groggy, executable };
}

function executableIsValid(status) {
  return status.executable && Object.values(status.executable).every((entry) => entry.valid);
}

function assertSupported(status) {
  if (!status.common.supportedSize || !status.common.profile) {
    fail(`지원하지 않는 캐릭터 패키지입니다. SHA-1: ${status.common.hash}`);
  }
  if (!status.groggy.supportedSize || !status.groggy.profile) {
    fail(`지원하지 않는 BrgGame 패키지입니다. SHA-1: ${status.groggy.hash}`);
  }
  if (!executableIsValid(status)) {
    fail('실행 파일의 패키지 해시가 현재 UPK와 일치하지 않습니다. Steam 검증 또는 백업 복원이 필요합니다.');
  }
}

function printStatus(status) {
  console.log(`\nLET IT DIE ${manifest.gameVersion}`);
  console.log(`설치 폴더: ${status.gameDirectory}`);
  if (status.common.profile) {
    const profile = manifest.common.profiles[status.common.profile];
    console.log(`저스트가드 강도: ${profile.label}`);
    console.log(`  가드 준비 ${Math.round(profile.guardReady * 1000)}ms / 시작 ${Math.round(profile.start * 1000)}ms / 유지 ${profile.duration.toFixed(3)}초`);
    console.log(`  고급 무기 확률 제한: ${profile.probabilityUnlocked ? '해제' : '순정'}`);
  } else {
    console.log(`저스트가드 강도: 알 수 없음 (${status.common.hash})`);
  }
  if (status.groggy.profile) {
    const runtime = manifest.groggy.profiles[status.groggy.profile];
    console.log(`저스트가드 그로기: ${groggyLabel(runtime.groggy)}`);
    console.log(`근접무기 방어 제한: ${meleeGuardLabel(runtime.meleeGuard)}`);
    console.log(`근접 속성 후속 피해: ${runtime.elementalNoDamage ? '저스트가드 시 차단' : '순정'}`);
  } else {
    console.log(`저스트가드 그로기: 알 수 없음 (${status.groggy.hash})`);
    console.log('근접무기 방어 제한: 알 수 없음');
    console.log('근접 속성 후속 피해: 알 수 없음');
  }
  console.log(`실행 파일 해시 연결: ${executableIsValid(status) ? '정상' : '불일치/확인 불가'}`);
}

function readPatch(patchPath) {
  const data = fs.readFileSync(patchPath);
  if (data.length < 12 || !data.subarray(0, 8).equals(PATCH_MAGIC)) {
    fail(`패치 파일 형식이 올바르지 않습니다: ${patchPath}`);
  }
  const count = data.readUInt32LE(8);
  const entries = [];
  let cursor = 12;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 8 > data.length) fail(`패치 항목 헤더가 잘렸습니다: ${patchPath}`);
    const offset = data.readUInt32LE(cursor);
    const size = data.readUInt32LE(cursor + 4);
    cursor += 8;
    if (cursor + size > data.length) fail(`패치 항목 데이터가 잘렸습니다: ${patchPath}`);
    entries.push({ offset, payload: data.subarray(cursor, cursor + size) });
    cursor += size;
  }
  if (cursor !== data.length) fail(`패치 파일에 알 수 없는 꼬리 데이터가 있습니다: ${patchPath}`);
  return entries;
}

function xorEntries(handle, entries) {
  for (const entry of entries) {
    const current = Buffer.allocUnsafe(entry.payload.length);
    const bytesRead = fs.readSync(handle, current, 0, current.length, entry.offset);
    if (bytesRead !== current.length) fail('XOR 패치 대상 데이터를 모두 읽지 못했습니다.');
    for (let index = 0; index < current.length; index += 1) {
      current[index] ^= entry.payload[index];
    }
    fs.writeSync(handle, current, 0, current.length, entry.offset);
  }
}

function makePatchedTemp(sourcePath, currentProfile, targetProfile, expectedSize, tempPath) {
  if (fs.existsSync(tempPath)) fail(`이전 작업의 임시 파일이 남아 있습니다: ${tempPath}`);
  fs.copyFileSync(sourcePath, tempPath, fs.constants.COPYFILE_EXCL);
  const handle = fs.openSync(tempPath, 'r+');
  try {
    const currentEntries = readPatch(path.join(ASSET_DIRECTORY, currentProfile.patch));
    const targetEntries = readPatch(path.join(ASSET_DIRECTORY, targetProfile.patch));
    for (const entry of [...currentEntries, ...targetEntries]) {
      if (entry.offset + entry.payload.length > expectedSize) {
        fail('XOR 패치 범위가 대상 파일을 벗어납니다.');
      }
    }
    // A profile delta is defined relative to stock. Applying the current
    // delta normalizes to stock; applying the target delta selects the target.
    xorEntries(handle, currentEntries);
    xorEntries(handle, targetEntries);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  if (fs.statSync(tempPath).size !== expectedSize) fail('임시 UPK 파일 크기 검증에 실패했습니다.');
  const actualHash = sha1File(tempPath);
  if (actualHash !== targetProfile.sha1) {
    fail(`임시 UPK SHA-1 검증에 실패했습니다: ${actualHash} (예상 ${targetProfile.sha1})`);
  }
}

function makeExecutableTemp(sourcePath, commonHash, groggyHash, tempPath) {
  if (fs.existsSync(tempPath)) fail(`이전 작업의 임시 파일이 남아 있습니다: ${tempPath}`);
  const executable = fs.readFileSync(sourcePath);
  const replacements = {
    'as_ch_main_male_common_sf.upk': commonHash,
    'brggame.upk': groggyHash,
  };
  for (const [assetName, expectedCount] of Object.entries(manifest.executable.manifestEntries)) {
    const offsets = manifestDigestPositions(executable, assetName, expectedCount);
    const digest = Buffer.from(replacements[assetName], 'hex');
    for (const offset of offsets) digest.copy(executable, offset);
  }
  fs.writeFileSync(tempPath, executable, { flag: 'wx' });
  const check = inspectExecutable(tempPath, commonHash, groggyHash);
  if (!Object.values(check).every((entry) => entry.valid)) {
    fail('임시 실행 파일의 패키지 해시 검증에 실패했습니다.');
  }
}

function backupRoot() {
  return path.join(__dirname, 'backups');
}

function createBackup(status, reason) {
  const directory = path.join(backupRoot(), timestamp());
  fs.mkdirSync(directory, { recursive: true });
  const metadata = {
    format: 1,
    createdAt: new Date().toISOString(),
    reason,
    gameDirectory: status.gameDirectory,
    files: {},
  };
  try {
    for (const key of FILE_KEYS) {
      const source = status.paths[key];
      const name = path.basename(source);
      const destination = path.join(directory, name);
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      metadata.files[key] = {
        name,
        size: fs.statSync(destination).size,
        sha1: sha1File(destination),
      };
    }
    fs.writeFileSync(
      path.join(directory, 'backup.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch (error) {
    error.message += `\n불완전한 백업 폴더를 확인하세요: ${directory}`;
    throw error;
  }
  return directory;
}

function listBackups() {
  const root = backupRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'backup.json')))
    .map((entry) => path.join(root, entry.name))
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
}

function readAndValidateBackup(directory) {
  const metadataPath = path.join(directory, 'backup.json');
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (error) {
    fail(`백업 정보를 읽을 수 없습니다: ${metadataPath}\n${error.message}`);
  }
  for (const key of FILE_KEYS) {
    const record = metadata.files?.[key];
    if (!record || !record.name || !record.sha1) fail(`백업 정보에 ${key} 파일이 없습니다.`);
    const filePath = path.join(directory, record.name);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size !== record.size || sha1File(filePath) !== record.sha1) {
      fail(`백업 파일 검증에 실패했습니다: ${filePath}`);
    }
  }
  return metadata;
}

function cleanupFiles(paths) {
  for (const filePath of paths) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
  }
}

function transactionalReplace(replacements) {
  const rollbackPaths = replacements.map(({ target }) => `${target}.lid-jg.rollback`);
  for (const rollbackPath of rollbackPaths) {
    if (fs.existsSync(rollbackPath)) fail(`이전 작업의 복구 파일이 남아 있습니다: ${rollbackPath}`);
  }

  const movedOriginals = [];
  const installedTargets = [];
  try {
    for (let index = 0; index < replacements.length; index += 1) {
      fs.renameSync(replacements[index].target, rollbackPaths[index]);
      movedOriginals.push(index);
    }
    for (let index = 0; index < replacements.length; index += 1) {
      fs.renameSync(replacements[index].temp, replacements[index].target);
      installedTargets.push(index);
    }
    cleanupFiles(rollbackPaths);
  } catch (error) {
    for (const index of [...installedTargets].reverse()) {
      try { fs.unlinkSync(replacements[index].target); } catch {}
    }
    for (const index of [...movedOriginals].reverse()) {
      if (!fs.existsSync(replacements[index].target) && fs.existsSync(rollbackPaths[index])) {
        try { fs.renameSync(rollbackPaths[index], replacements[index].target); } catch {}
      }
    }
    throw error;
  }
}

function applySettings(gameDirectory, strengthName, groggyName, meleeGuardName) {
  if (!manifest.common.profiles[strengthName]) fail(`알 수 없는 강도입니다: ${strengthName}`);
  if (!GROGGY_ORDER.includes(groggyName)) fail(`알 수 없는 그로기 설정입니다: ${groggyName}`);
  if (!MELEE_GUARD_ORDER.includes(meleeGuardName)) fail(`알 수 없는 근접무기 방어 설정입니다: ${meleeGuardName}`);
  const targetRuntimeName = findRuntimeProfile(groggyName, meleeGuardName);
  if (!targetRuntimeName) fail(`지원하지 않는 조합입니다: 그로기 ${groggyName}, 근접 방어 ${meleeGuardName}`);
  if (isGameRunning()) fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');

  const status = readStatus(gameDirectory);
  assertSupported(status);
  if (status.common.profile === strengthName && status.groggy.profile === targetRuntimeName) {
    return { changed: false, status };
  }

  const backupPath = createBackup(status, `apply:${strengthName}:${groggyName}:${meleeGuardName}`);
  const commonProfile = manifest.common.profiles[strengthName];
  const groggyProfile = manifest.groggy.profiles[targetRuntimeName];
  const temps = {
    common: `${status.paths.common}.lid-jg.tmp`,
    groggy: `${status.paths.groggy}.lid-jg.tmp`,
    executable: `${status.paths.executable}.lid-jg.tmp`,
  };

  try {
    makePatchedTemp(
      status.paths.common,
      manifest.common.profiles[status.common.profile],
      commonProfile,
      manifest.common.size,
      temps.common,
    );
    makePatchedTemp(
      status.paths.groggy,
      manifest.groggy.profiles[status.groggy.profile],
      groggyProfile,
      manifest.groggy.size,
      temps.groggy,
    );
    makeExecutableTemp(status.paths.executable, commonProfile.sha1, groggyProfile.sha1, temps.executable);
    transactionalReplace(FILE_KEYS.map((key) => ({ target: status.paths[key], temp: temps[key] })));
  } catch (error) {
    cleanupFiles(Object.values(temps));
    error.message += `\n변경 전 백업: ${backupPath}`;
    throw error;
  }

  const verified = readStatus(gameDirectory);
  if (verified.common.profile !== strengthName || verified.groggy.profile !== targetRuntimeName || !executableIsValid(verified)) {
    fail(`적용 후 검증에 실패했습니다. 변경 전 백업: ${backupPath}`);
  }
  return { changed: true, backupPath, status: verified };
}

function restoreBackup(gameDirectory, backupPath) {
  if (isGameRunning()) fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
  const metadata = readAndValidateBackup(backupPath);
  const current = readStatus(gameDirectory);
  const safetyBackup = createBackup(current, `before-restore:${path.basename(backupPath)}`);
  const temps = {};
  try {
    for (const key of FILE_KEYS) {
      temps[key] = `${current.paths[key]}.lid-jg.tmp`;
      if (fs.existsSync(temps[key])) fail(`이전 작업의 임시 파일이 남아 있습니다: ${temps[key]}`);
      fs.copyFileSync(path.join(backupPath, metadata.files[key].name), temps[key], fs.constants.COPYFILE_EXCL);
      if (sha1File(temps[key]) !== metadata.files[key].sha1) fail(`복원 임시 파일 검증 실패: ${temps[key]}`);
    }
    transactionalReplace(FILE_KEYS.map((key) => ({ target: current.paths[key], temp: temps[key] })));
  } catch (error) {
    cleanupFiles(Object.values(temps));
    error.message += `\n복원 직전 안전 백업: ${safetyBackup}`;
    throw error;
  }

  for (const key of FILE_KEYS) {
    if (sha1File(current.paths[key]) !== metadata.files[key].sha1) {
      fail(`복원 후 ${key} 파일 검증에 실패했습니다. 안전 백업: ${safetyBackup}`);
    }
  }
  return { backupPath, safetyBackup, status: readStatus(gameDirectory) };
}

function parseCommandLine(argv) {
  const positional = [];
  let gameDirectory;
  let yes = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--game') {
      if (!argv[index + 1]) fail('--game 뒤에 설치 폴더가 필요합니다.');
      gameDirectory = argv[++index];
    } else if (argv[index] === '--yes') {
      yes = true;
    } else {
      positional.push(argv[index]);
    }
  }
  return { positional, gameDirectory, yes };
}

async function confirm(rl, message, assumeYes) {
  if (assumeYes) return true;
  const answer = (await rl.question(`${message} (y/N): `)).trim().toLowerCase();
  return answer === 'y' || answer === 'yes' || answer === 'ㅇ';
}

function printStrengthChoices() {
  console.log('\n저스트가드 강도');
  STRENGTH_ORDER.forEach((name, index) => {
    const item = manifest.common.profiles[name];
    console.log(`${index + 1}. ${item.label} — 준비 ${Math.round(item.guardReady * 1000)}ms / 시작 ${Math.round(item.start * 1000)}ms / 유지 ${item.duration.toFixed(3)}초` +
      `${item.probabilityUnlocked ? ' / 고급 무기 제한 해제' : ''}`);
  });
}

async function interactive(gameDirectory, rl) {
  while (true) {
    const status = readStatus(gameDirectory);
    printStatus(status);
    console.log('\n1. 설정 적용');
    console.log('2. 현재 게임 파일 백업');
    console.log('3. 최신 백업 복원');
    console.log('4. 종료');
    const choice = (await rl.question('선택: ')).trim();

    if (choice === '4') return;
    if (choice === '1') {
      assertSupported(status);
      printStrengthChoices();
      const strengthChoice = Number((await rl.question('강도 선택: ')).trim());
      const strength = STRENGTH_ORDER[strengthChoice - 1];
      if (!strength) {
        console.log('잘못된 선택입니다.');
        continue;
      }
      console.log('\n그로기 판정');
      console.log('1. OFF — 순정 Flip 반응');
      console.log('2. ON — 직접 공격한 상대를 정식 Groggy 상태로');
      const groggyChoice = Number((await rl.question('그로기 선택: ')).trim());
      const groggy = GROGGY_ORDER[groggyChoice - 1];
      if (!groggy) {
        console.log('잘못된 선택입니다.');
        continue;
      }
      console.log('\n근접무기 저스트가드 불가 제한');
      console.log('1. OFF — 순정 제한 유지');
      console.log('2. ON — 직접 근접 공격 제한 해제 + 성공 시 화염·전기·독 후속 피해 차단');
      const meleeGuardChoice = Number((await rl.question('근접무기 방어 선택: ')).trim());
      const meleeGuard = MELEE_GUARD_ORDER[meleeGuardChoice - 1];
      if (!meleeGuard) {
        console.log('잘못된 선택입니다.');
        continue;
      }
      const strengthLabel = manifest.common.profiles[strength].label;
      if (!await confirm(rl, `${strengthLabel} / 그로기 ${groggy.toUpperCase()} / 근접 방어 ${meleeGuard.toUpperCase()}를 적용할까요?`, false)) continue;
      const result = applySettings(gameDirectory, strength, groggy, meleeGuard);
      console.log(result.changed ? `\n적용 완료\n백업: ${result.backupPath}` : '\n이미 선택한 설정입니다.');
      continue;
    }
    if (choice === '2') {
      if (isGameRunning()) fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
      const backupPath = createBackup(status, 'manual');
      console.log(`\n백업 완료: ${backupPath}`);
      continue;
    }
    if (choice === '3') {
      const backups = listBackups();
      if (backups.length === 0) {
        console.log('\n복원할 백업이 없습니다.');
        continue;
      }
      const latest = backups[0];
      const info = readAndValidateBackup(latest);
      console.log(`\n복원 대상: ${latest}`);
      console.log(`생성 시각: ${info.createdAt}`);
      console.log(`사유: ${info.reason}`);
      if (!await confirm(rl, '이 백업으로 게임 파일 3개를 복원할까요?', false)) continue;
      const result = restoreBackup(gameDirectory, latest);
      console.log(`\n복원 완료: ${result.backupPath}`);
      console.log(`복원 직전 안전 백업: ${result.safetyBackup}`);
      continue;
    }
    console.log('잘못된 선택입니다.');
  }
}

async function main() {
  const parsed = parseCommandLine(process.argv.slice(2));
  const gameDirectory = discoverGameDirectory(parsed.gameDirectory);
  const command = String(parsed.positional[0] || '').toLowerCase();
  const interactiveMode = !command;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (interactiveMode) {
      await interactive(gameDirectory, rl);
      return;
    }
    if (command === 'status') {
      printStatus(readStatus(gameDirectory));
      return;
    }
    if (command === 'repair-guard-state') {
      if (isGameRunning()) fail('LET IT DIE를 완전히 종료한 뒤 다시 실행하세요.');
      if (!await confirm(rl, '확인된 가드 스크립트의 잘못된 점프를 수정할까요?', parsed.yes)) return;
      const result = require('./guard-state-repair').repair(gameDirectory, path.join(__dirname, 'backups'));
      console.log(result.changed ? `가드 분기 수정 완료. 변경 전 백업: ${result.backupPath}` : '이미 수정되어 있습니다.');
      return;
    }
    if (command === 'backup') {
      if (isGameRunning()) fail('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.');
      const backupPath = createBackup(readStatus(gameDirectory), 'manual-cli');
      console.log(`백업 완료: ${backupPath}`);
      return;
    }
    if (command === 'apply') {
      const strength = String(parsed.positional[1] || '').toLowerCase();
      const groggy = String(parsed.positional[2] || '').toLowerCase();
      const meleeGuard = String(parsed.positional[3] || 'off').toLowerCase();
      if (!manifest.common.profiles[strength] || !GROGGY_ORDER.includes(groggy) || !MELEE_GUARD_ORDER.includes(meleeGuard)) {
        fail('사용법: apply [stock|soft|wide|iron] [그로기 off|on] [근접 방어 off|on]');
      }
      const status = readStatus(gameDirectory);
      printStatus(status);
      if (!await confirm(rl, `${manifest.common.profiles[strength].label} / 그로기 ${groggy.toUpperCase()} / 근접 방어 ${meleeGuard.toUpperCase()}를 적용할까요?`, parsed.yes)) return;
      const result = applySettings(gameDirectory, strength, groggy, meleeGuard);
      console.log(result.changed ? `적용 완료\n백업: ${result.backupPath}` : '이미 선택한 설정입니다.');
      return;
    }
    if (command === 'restore') {
      const backups = listBackups();
      const backupPath = parsed.positional[1] ? path.resolve(parsed.positional[1]) : backups[0];
      if (!backupPath) fail('복원할 백업이 없습니다.');
      readAndValidateBackup(backupPath);
      if (!await confirm(rl, `${backupPath} 백업을 복원할까요?`, parsed.yes)) return;
      const result = restoreBackup(gameDirectory, backupPath);
      console.log(`복원 완료: ${result.backupPath}`);
      console.log(`복원 직전 안전 백업: ${result.safetyBackup}`);
      return;
    }
    fail('사용법: node lid-justguard.js [status | backup | apply 강도 그로기 근접방어 | restore] [--game 경로] [--yes]');
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`\n오류: ${error.userFacing ? error.message : (error.stack || error.message)}`);
  process.exitCode = 1;
});
