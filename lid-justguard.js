#!/usr/bin/env node
'use strict';
const sharedLayers = require('./shared/layers');
const ownedFunctions = require('./shared/owned-functions');

const { configure, text: t } = require('./language');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const readline = require('readline/promises');
const m2gCompat = require('./compat/m2g');
const embedded = require('./compat/m2g/embedded');
const restoreSafety = require('./restore-safety');

const PATCH_MAGIC = Buffer.from('LIDXOR1\0', 'ascii');
const ASSET_DIRECTORY = path.join(__dirname, 'assets');
const MANIFEST_PATH = path.join(ASSET_DIRECTORY, 'manifest.json');
let manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

const STRENGTH_ORDER = ['stock', 'soft', 'wide', 'iron'];
const GROGGY_ORDER = ['off', 'on'];
const MELEE_GUARD_ORDER = ['off', 'on'];
const FILE_KEYS = ['common', 'groggy', 'executable'];
const STOCK_HASHES = {
  'brggame.upk': 'C4D8C0EFBCBDB0CDE3E3CF1F5DA07EFB1996C207',
  'as_ch_main_male_common_sf.upk': '757EC07E9846C817FB16780BB5C5ADCAB8A75588',
};

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
    if (!isGameDirectory(resolved)) fail(t(`LET IT DIE 설치 파일을 찾지 못했습니다: ${resolved}`, `LET IT DIE installation files not found: ${resolved}`));
    return resolved;
  }

  const matches = [];
  for (const root of findSteamRoots()) {
    const candidate = path.join(root, 'steamapps', 'common', 'LET IT DIE');
    if (isGameDirectory(candidate)) matches.push(candidate);
  }
  const unique = [...new Set(matches.map((item) => path.resolve(item)))];
  if (unique.length === 0) {
    fail(t('LET IT DIE 설치 폴더를 자동으로 찾지 못했습니다. --game "설치 경로"를 사용하세요.', 'LET IT DIE installation not found automatically. Use --game "installation path".'));
  }
  if (unique.length > 1) {
    fail(t(`LET IT DIE 설치 폴더가 여러 개입니다. --game으로 지정하세요:\n${unique.join('\n')}`, `Multiple LET IT DIE installations found. Specify --game:\n${unique.join('\n')}`));
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
  if (configuration === manifest.groggy && manifest.steamBuildId === '25244463') {
    const found = embedded.identify(fs.readFileSync(filePath));
    if (found) {
      const name = Object.entries(configuration.profiles).find(([,p]) => p.sha1 === found.profile.sha1)?.[0];
      if (name) return {profile:name,hash,size,supportedSize:true,embeddedM2g:true,m2g:found.enabled};
    }
  }
  const profile = Object.entries(configuration.profiles)
    .find(([, value]) => value.sha1 === hash)?.[0];
  const supportedSize = Object.values(configuration.profiles).some((item) => item.sha1 === hash && item.size === size) || (Array.isArray(configuration.size)
    ? configuration.size.includes(size)
    : size === configuration.size);
  if (!profile && configuration === manifest.groggy && ['25136512', '25386710'].includes(manifest.steamBuildId)) {
    const knife = m2gCompat.identify(hash);
    const baseName = knife && Object.entries(configuration.profiles).find(([, p]) => p.sha1 === knife.baseSha1)?.[0];
    if (baseName) return { profile: baseName, hash, size, supportedSize: true, m2g: true, legacyM2g: !!knife.legacy };
  }
  if(!profile&&manifest.steamBuildId==='25386710'){
    try{
      const file=path.basename(filePath),state=ownedFunctions.inspect(fs.readFileSync(filePath),'guard',file);
      return {profile:state==='off'?(configuration===manifest.common?'stock':'off-off'):state,hash,size,supportedSize:true,scoped:true};
    }catch(error){return {profile:null,hash,size,supportedSize:false,conflict:error.message};}
  }
  return { profile, hash, size, supportedSize };
}

function findRuntimeProfile(groggyName, meleeGuardName) {
  return Object.entries(manifest.groggy.profiles)
    .find(([, profile]) => profile.groggy === groggyName && profile.meleeGuard === meleeGuardName)?.[0];
}

function groggyLabel(name) {
  return name === 'on' ? t('ON (직접 공격자 Groggy)', 'ON (Groggy for direct attacker)') : t('OFF (순정 Flip)', 'OFF (stock Flip)');
}

function meleeGuardLabel(name) {
  return name === 'on'
    ? t('ON (근접무기 저스트가드 불가 제한 해제)', 'ON (melee Just Guard restrictions removed)')
    : t('OFF (순정 제한)', 'OFF (stock restrictions)');
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
  const pe = executable.length >= 64 ? executable.readUInt32LE(60) : 0;
  if (pe && pe + 4 <= executable.length && executable.toString('ascii', pe, pe + 4) === 'PE\0\0') {
    try { return require('./shared/kernel/src/executable-links').digestOffsets(executable, assetName, expectedCount); }
    catch (error) { fail(error.message); }
  }
  const needle = Buffer.from(`${assetName.toLowerCase()}\0`, 'ascii');
  const positions = findAll(executable, needle);
  if (positions.length !== expectedCount) {
    fail(t(`${assetName} 실행 파일 해시 항목이 ${expectedCount}개가 아닙니다: ${positions.length}개`, `${assetName} executable hash entry count: expected ${expectedCount}, found ${positions.length}`));
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
    const records = require('./shared/kernel/src/executable-links').digestEntries(executable, assetName, expectedCount);
    results[assetName] = { offsets, digests, checkDisabled: records.every(e => !e.checked), valid: records.every((e, i) => !e.checked || digests[i] === expected[assetName]) };
  }
  return results;
}

function readStatus(gameDirectory) {
  if(sharedLayers.active(gameDirectory))return sharedLayers.view(gameDirectory,stage=>{
    const status=readStatus(stage);status.gameDirectory=gameDirectory;
    for(const key of Object.keys(status.paths))status.paths[key]=path.join(gameDirectory,path.relative(stage,status.paths[key]));
    status.sharedVending=true;return status;
  });
  selectBuild(gameDirectory);
  const paths = expectedPaths(gameDirectory);
  const common = identifyProfile(paths.common, manifest.common);
  const groggy = identifyProfile(paths.groggy, manifest.groggy);
  // Digest linkage is independent of whether the package has a known profile.
  const executable = inspectExecutable(paths.executable, common.hash, groggy.hash);
  return { gameDirectory, paths, common, groggy, executable };
}

function selectBuild(gameDirectory) {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  STOCK_HASHES['brggame.upk'] = 'C4D8C0EFBCBDB0CDE3E3CF1F5DA07EFB1996C207';
  STOCK_HASHES['as_ch_main_male_common_sf.upk'] = '757EC07E9846C817FB16780BB5C5ADCAB8A75588';
  for (const build of ['25386710', '25244463', '25136512']) {
    const candidatePath = path.join(ASSET_DIRECTORY, `manifest-${build}.json`);
    if (!fs.existsSync(candidatePath)) continue;
    const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
    const file = path.join(gameDirectory, candidate.common.relativePath);
    if (!fs.existsSync(file)) continue;
    const digest = sha1File(file);
    if (Object.values(candidate.common.profiles).some((p) => p.sha1 === digest)) {
      manifest = candidate;
      STOCK_HASHES['brggame.upk'] = candidate.groggy.profiles['off-off'].sha1;
      STOCK_HASHES['as_ch_main_male_common_sf.upk'] = candidate.common.profiles.stock.sha1;
      return;
    }
    if(build==='25386710'){
      try{ownedFunctions.inspect(fs.readFileSync(file),'guard',path.basename(file));manifest=candidate;return;}catch{}
    }
  }
}

function executableIsValid(status) {
  return status.executable && Object.values(status.executable).every((entry) => entry.valid);
}

function assertSupported(status) {
  if (!status.common.supportedSize || !status.common.profile) {
    fail(t(`지원하지 않는 캐릭터 패키지입니다. SHA-1: ${status.common.hash}`, `Unsupported character package. SHA-1: ${status.common.hash}`));
  }
  if (!status.groggy.supportedSize || !status.groggy.profile) {
    fail(t(`지원하지 않는 BrgGame 패키지입니다. SHA-1: ${status.groggy.hash}`, `Unsupported BrgGame package. SHA-1: ${status.groggy.hash}`));
  }
  if (!executableIsValid(status)) {
    fail(t('실행 파일의 패키지 해시가 현재 UPK와 일치하지 않습니다. Steam 검증 또는 백업 복원이 필요합니다.', 'Executable package hashes do not match the current UPK. Steam file verification or backup restoration is required.'));
  }
}

function strengthDisplay(name) {
  return t(manifest.common.profiles[name]?.label || name, { stock: 'Stock', soft: 'Relaxed', wide: 'Wide', iron: 'Iron-like' }[name] || name);
}

function printStatus(status) {
  if(status.sharedVending)console.log(t('공통 합성 관리: 자판기 기능을 보존하며 가드 설정 변경 가능','Shared composition: vending is preserved when changing guard settings'));
  if (t(false, true)) {
    if (manifest.steamBuildId) console.log('New-build trial: file apply/restore verified; in-game combat verification pending');
    console.log(`\nLET IT DIE ${manifest.gameVersion}`);
    console.log(`Installation: ${status.gameDirectory}`);
    if (status.common.profile) {
      const profile = manifest.common.profiles[status.common.profile];
      console.log(`Just Guard strength: ${strengthDisplay(status.common.profile)}`);
      console.log(`  Guard ready ${Math.round(profile.guardReady * 1000)}ms / start ${Math.round(profile.start * 1000)}ms / duration ${profile.duration.toFixed(3)}s`);
      console.log(`  High-tier weapon probability restriction: ${profile.probabilityUnlocked ? 'Removed' : 'Stock'}`);
    } else console.log(`Just Guard strength: Unknown (${status.common.hash})`);
    if (status.groggy.profile) {
      const runtime = manifest.groggy.profiles[status.groggy.profile];
      if (status.groggy.m2g) console.log(`M2G knife: Applied${status.groggy.legacyM2g ? ' (legacy)' : ''}; preserved when guard settings change`);
      else if (status.groggy.embeddedM2g) console.log('M2G knife: Not applied; preserved when guard settings change');
      if (runtime.warpCentered) console.log('Warp start-floor menu: preserved');
      console.log(`Just Guard groggy: ${groggyLabel(runtime.groggy)}`);
      console.log(`Melee guard restrictions: ${meleeGuardLabel(runtime.meleeGuard)}`);
      console.log(`Melee elemental follow-up damage: ${runtime.elementalNoDamage ? 'Blocked on Just Guard' : 'Stock'}`);
      if (runtime.aiJustGuardDisabled) console.log('Enemy AI Just Guard: disabled (player only)');
      if (runtime.pickaxeGuardEnabled) console.log('Pickaxe attacks: Just Guard allowed');
      if (runtime.battleAxeGuardEnabled) console.log('Battle axe attacks: Just Guard allowed');
      if (runtime.extendedVfxEnabled) console.log('Extended-window visual effect: enabled (prevents early disappearance at 0.242s)');
    } else {
      console.log(`Just Guard groggy: Unknown (${status.groggy.hash})`);
      console.log('Melee guard restrictions: Unknown');
      console.log('Melee elemental follow-up damage: Unknown');
    }
    console.log(`Executable hash links: ${executableIsValid(status) ? 'Valid' : 'Mismatch/unknown'}`);
    const disabled = Object.entries(status.executable || {}).filter(([, e]) => e.checkDisabled).map(([name]) => name);
    if (disabled.length) console.log('External manager file checks OFF (preserved): ' + disabled.join(', '));
    return;
  }
  if (manifest.steamBuildId) console.log('새 빌드 대응 시험판: 파일 적용·복원 검증 완료 / 실게임 전투 검증 전');
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
    if (status.groggy.m2g) console.log(`M2G 나이프: 적용됨${status.groggy.legacyM2g ? ' (구버전 적용본)' : ''} · 가드 설정 변경 시 유지`);
    else if (status.groggy.embeddedM2g) console.log('M2G 나이프: 미적용 · 가드 설정 변경 시 유지');
    if (runtime.warpCentered) console.log('워프 시작층 메뉴: 유지');
    console.log(`저스트가드 그로기: ${groggyLabel(runtime.groggy)}`);
    console.log(`근접무기 방어 제한: ${meleeGuardLabel(runtime.meleeGuard)}`);
    console.log(`근접 속성 후속 피해: ${runtime.elementalNoDamage ? '저스트가드 시 차단' : '순정'}`);
    if (runtime.aiJustGuardDisabled) {
      console.log('적 AI 저스트가드: 차단 (플레이어 전용)');
    }
    if (runtime.pickaxeGuardEnabled) {
      console.log('곡괭이 공격 방어: 저스트가드 허용');
    }
    if (runtime.battleAxeGuardEnabled) {
      console.log('양손도끼 공격 방어: 저스트가드 허용');
    }
    if (runtime.extendedVfxEnabled) {
      console.log('확장 판정 시각 이펙트: 활성화 (0.242초 조기 소멸 방지)');
    }
  } else {
    console.log(`저스트가드 그로기: 알 수 없음 (${status.groggy.hash})`);
    console.log('근접무기 방어 제한: 알 수 없음');
    console.log('근접 속성 후속 피해: 알 수 없음');
  }
  console.log(`실행 파일 해시 연결: ${executableIsValid(status) ? '정상' : '불일치/확인 불가'}`);
  const disabled = Object.entries(status.executable || {}).filter(([, e]) => e.checkDisabled).map(([name]) => name);
  if (disabled.length) console.log('외부 관리자의 파일 검사 OFF (유지): ' + disabled.join(', '));
}

function readPatch(patchPath) {
  const data = fs.readFileSync(patchPath);
  if (data.length < 12 || !data.subarray(0, 8).equals(PATCH_MAGIC)) {
    fail(t(`패치 파일 형식이 올바르지 않습니다: ${patchPath}`, `Invalid patch file format: ${patchPath}`));
  }
  const count = data.readUInt32LE(8);
  const entries = [];
  let cursor = 12;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 8 > data.length) fail(t(`패치 항목 헤더가 잘렸습니다: ${patchPath}`, `Truncated patch entry header: ${patchPath}`));
    const offset = data.readUInt32LE(cursor);
    const size = data.readUInt32LE(cursor + 4);
    cursor += 8;
    if (cursor + size > data.length) fail(t(`패치 항목 데이터가 잘렸습니다: ${patchPath}`, `Truncated patch entry data: ${patchPath}`));
    entries.push({ offset, payload: data.subarray(cursor, cursor + size) });
    cursor += size;
  }
  if (cursor !== data.length) fail(t(`패치 파일에 알 수 없는 꼬리 데이터가 있습니다: ${patchPath}`, `Unknown trailing data in patch file: ${patchPath}`));
  return entries;
}

function xorEntries(handle, entries) {
  for (const entry of entries) {
    const current = Buffer.allocUnsafe(entry.payload.length);
    const bytesRead = fs.readSync(handle, current, 0, current.length, entry.offset);
    if (bytesRead !== current.length) fail(t('XOR 패치 대상 데이터를 모두 읽지 못했습니다.', 'Could not read all XOR patch target data.'));
    for (let index = 0; index < current.length; index += 1) {
      current[index] ^= entry.payload[index];
    }
    fs.writeSync(handle, current, 0, current.length, entry.offset);
  }
}

function makePatchedTemp(sourcePath, currentProfile, targetProfile, expectedSize, tempPath) {
  if (fs.existsSync(tempPath)) fail(t(`이전 작업의 임시 파일이 남아 있습니다: ${tempPath}`, `A temporary file from a previous operation remains: ${tempPath}`));

  const fileName = path.basename(sourcePath).toLowerCase();
  const stockHash = STOCK_HASHES[fileName];
  const bakPath = `${sourcePath}.bak`;

  let baseFromBak = false;
  if (stockHash && fs.existsSync(bakPath)) {
    const bakHash = sha1File(bakPath);
    if (bakHash === stockHash) {
      fs.copyFileSync(bakPath, tempPath, fs.constants.COPYFILE_EXCL);
      baseFromBak = true;
    }
  }

  if (!baseFromBak) {
    fs.copyFileSync(sourcePath, tempPath, fs.constants.COPYFILE_EXCL);
    if (stockHash && !fs.existsSync(bakPath) && sha1File(sourcePath) === stockHash) {
      try { fs.copyFileSync(sourcePath, bakPath); } catch {}
    }
  }

  const targetSize = targetProfile.size || (baseFromBak ? fs.statSync(tempPath).size : (currentProfile.xorBaseSize || fs.statSync(tempPath).size));
  const handle = fs.openSync(tempPath, 'r+');
  try {
    const workSize = Math.max(fs.fstatSync(handle).size, targetSize);
    fs.ftruncateSync(handle, workSize);
    const currentEntries = baseFromBak ? [] : readPatch(path.join(ASSET_DIRECTORY, currentProfile.patch));
    const targetEntries = readPatch(path.join(ASSET_DIRECTORY, targetProfile.patch));
    for (const entry of [...currentEntries, ...targetEntries]) {
      if (entry.offset + entry.payload.length > workSize) {
        fail(t('XOR 패치 범위가 대상 파일을 벗어납니다.', 'XOR patch exceeds target file bounds.'));
      }
    }
    // A profile delta is defined relative to stock. Applying the current
    // delta normalizes to stock; applying the target delta selects the target.
    if (!baseFromBak) {
      xorEntries(handle, currentEntries);
    }
    xorEntries(handle, targetEntries);
    fs.ftruncateSync(handle, targetSize);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  const tempSize = fs.statSync(tempPath).size;
  const isExpectedSize = tempSize === targetSize;
  if (!isExpectedSize) fail(t('임시 UPK 파일 크기 검증에 실패했습니다.', 'Temporary UPK file size verification failed.'));
  const actualHash = sha1File(tempPath);
  if (actualHash !== targetProfile.sha1) {
    fail(t(`임시 UPK SHA-1 검증에 실패했습니다: ${actualHash} (예상 ${targetProfile.sha1})`, `Temporary UPK SHA-1 verification failed: ${actualHash} (expected ${targetProfile.sha1})`));
  }
}

function makeExecutableTemp(sourcePath, commonHash, groggyHash, tempPath) {
  if (fs.existsSync(tempPath)) fail(t(`이전 작업의 임시 파일이 남아 있습니다: ${tempPath}`, `A temporary file from a previous operation remains: ${tempPath}`));
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
    fail(t('임시 실행 파일의 패키지 해시 검증에 실패했습니다.', 'Temporary executable package hash verification failed.'));
  }
}

function makeM2gPatchedTemp(sourcePath, currentProfile, targetProfile, tempPath) {
  if (fs.existsSync(tempPath)) fail(t(`이전 임시 파일이 남아 있습니다: ${tempPath}`, `A previous temporary file remains: ${tempPath}`));
  const base = m2gCompat.strip(fs.readFileSync(sourcePath));
  const targetSize = targetProfile.size;
  const buffer = Buffer.alloc(Math.max(base.length, targetSize));
  base.copy(buffer);
  // Both deltas are relative to the same stock package. Do not consult .bak:
  // its warp/guard state may differ from the currently recognized input.
  for (const profile of [currentProfile, targetProfile]) {
    for (const { offset, payload } of readPatch(path.join(ASSET_DIRECTORY, profile.patch))) {
      if (offset + payload.length > buffer.length) fail(t('M2G 보존 XOR 범위 오류', 'M2G-preserving XOR bounds error'));
      for (let i = 0; i < payload.length; i++) buffer[offset + i] ^= payload[i];
    }
  }
  const target = buffer.subarray(0, targetSize);
  if (crypto.createHash('sha1').update(target).digest('hex').toUpperCase() !== targetProfile.sha1) fail(t('M2G 보존 가드 패치 검증 실패', 'M2G-preserving guard patch verification failed'));
  const expected = m2gCompat.forBase(targetProfile.sha1);
  if (!expected) fail(t('지원하지 않는 M2G/가드 조합입니다.', 'Unsupported M2G/guard combination.'));
  const output = m2gCompat.rebuild(target);
  fs.writeFileSync(tempPath, output, { flag: 'wx' });
  if (sha1File(tempPath) !== expected.sha1) fail(t('M2G 보존 임시 파일 검증 실패', 'M2G-preserving temporary file verification failed'));
  return expected.sha1;
}

function makeEmbeddedTemp(sourcePath, currentProfile, targetProfile, tempPath, enabled) {
  if (fs.existsSync(tempPath)) fail(t('이전 임시 파일이 남아 있습니다.', 'A previous temporary file remains.'));
  const source = embedded.set(fs.readFileSync(sourcePath), true);
  const buffer = Buffer.alloc(Math.max(source.length, targetProfile.size));
  source.copy(buffer);
  for (const profile of [currentProfile,targetProfile]) {
    for (const {offset,payload} of readPatch(path.join(ASSET_DIRECTORY,profile.patch))) {
      if (offset + payload.length > buffer.length) fail(t('패치 범위 오류', 'Patch bounds error'));
      for (let i=0;i<payload.length;i++) buffer[offset+i]^=payload[i];
    }
  }
  const target=buffer.subarray(0,targetProfile.size);
  if (crypto.createHash('sha1').update(target).digest('hex').toUpperCase()!==targetProfile.sha1) fail(t('가드 변환 검증 실패', 'Guard conversion verification failed'));
  const result=embedded.set(target,enabled);
  fs.writeFileSync(tempPath,result,{flag:'wx'});
  return sha1File(tempPath);
}

function backupRoot() {
  if(process.env.LID_SHARED_STAGE_BACKUP)return process.env.LID_SHARED_STAGE_BACKUP;
  return path.join(__dirname, 'backups');
}

function createBackup(status, reason) {
  if(status.sharedVending)return sharedLayers.backup(status.gameDirectory,'guard');
  const directory = path.join(backupRoot(), timestamp());
  fs.mkdirSync(directory, { recursive: true });
  const metadata = {
    format: 1,
    steamBuildId: manifest.steamBuildId || null,
    createdAt: new Date().toISOString(),
    reason,
    gameDirectory: status.gameDirectory,
    beforeSnapshot: restoreSafety.capture(status.gameDirectory),
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
    error.message += t(`\n불완전한 백업 폴더를 확인하세요: ${directory}`, `\nCheck the incomplete backup folder: ${directory}`);
    throw error;
  }
  return directory;
}

function listBackups(gameDirectory) {
  const root = backupRoot();
  const shared=gameDirectory?sharedLayers.backups(gameDirectory,'guard'):[];
  if (!fs.existsSync(root)) return shared;
  return [...shared,...fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'backup.json')))
    .map((entry) => path.join(root, entry.name))
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left)))];
}

function readAndValidateBackup(directory) {
  if(sharedLayers.isBackup(directory)){const m=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));return {createdAt:path.basename(directory),reason:'shared composition: '+m.kind};}
  const metadataPath = path.join(directory, 'backup.json');
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (error) {
    fail(t(`백업 정보를 읽을 수 없습니다: ${metadataPath}\n${error.message}`, `Cannot read backup information: ${metadataPath}\n${error.message}`));
  }
  for (const key of FILE_KEYS) {
    const record = metadata.files?.[key];
    if (!record || !record.name || !record.sha1) fail(t(`백업 정보에 ${key} 파일이 없습니다.`, `Backup information is missing file ${key}.`));
    const filePath = path.join(directory, record.name);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size !== record.size || sha1File(filePath) !== record.sha1) {
      fail(t(`백업 파일 검증에 실패했습니다: ${filePath}`, `Backup file verification failed: ${filePath}`));
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
    if (fs.existsSync(rollbackPath)) fail(t(`이전 작업의 복구 파일이 남아 있습니다: ${rollbackPath}`, `A recovery file from a previous operation remains: ${rollbackPath}`));
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

function applyScopedGuardFiles(stage,strengthName,groggyName,meleeGuardName){
  if(!['stock','soft','wide','iron'].includes(strengthName)||!['on','off'].includes(groggyName)||!['on','off'].includes(meleeGuardName))fail('Invalid scoped guard settings');
  const runtimeName=groggyName+'-'+meleeGuardName;
  const packages=[['AS_CH_Main_Male_Common_SF.upk',strengthName==='stock'?'off':strengthName],['BrgGame.upk',runtimeName==='off-off'?'off':runtimeName]];
  const executablePath=path.join(stage,'Binaries/Win64/BrgGame-Steam.exe'),exe=fs.readFileSync(executablePath);
  require('./shared/kernel/src/executable-links').validatePackageLinks(exe,stage);
  const next=Buffer.from(exe),writes=[];
  for(const [file,preset] of packages){
    const p=path.join(stage,'BrgGame/CookedPCConsole',file),before=fs.readFileSync(p),after=ownedFunctions.set(before,'guard',file,preset);
    ownedFunctions.verifyTransition(before,after,'guard',file);
    const count=file==='BrgGame.upk'?2:1;
    for(const at of manifestDigestPositions(next,file.toLowerCase(),count))crypto.createHash('sha1').update(after).digest().copy(next,at);
    writes.push([p,after]);
  }
  // Both packages and their link changes are fully checked before even staging writes.
  for(const [p,after] of writes)fs.writeFileSync(p,after);
  fs.writeFileSync(executablePath,next);
  return {guard:strengthName,groggy:groggyName,melee:meleeGuardName};
}
function applySettings(gameDirectory, strengthName, groggyName, meleeGuardName) {
  if(sharedLayers.active(gameDirectory)){
    const tx=sharedLayers.transact(gameDirectory,'guard',stage=>{
      selectBuild(stage);
      return {result:manifest.steamBuildId==='25386710'?applyScopedGuardFiles(stage,strengthName,groggyName,meleeGuardName):applySettings(stage,strengthName,groggyName,meleeGuardName)};
    });
    return {changed:tx.changed,backupPath:tx.backup,status:readStatus(gameDirectory)};
  }
  selectBuild(gameDirectory);
  if (!manifest.common.profiles[strengthName]) fail(t(`알 수 없는 강도입니다: ${strengthName}`, `Unknown strength: ${strengthName}`));
  if (!GROGGY_ORDER.includes(groggyName)) fail(t(`알 수 없는 그로기 설정입니다: ${groggyName}`, `Unknown groggy setting: ${groggyName}`));
  if (!MELEE_GUARD_ORDER.includes(meleeGuardName)) fail(t(`알 수 없는 근접무기 방어 설정입니다: ${meleeGuardName}`, `Unknown melee guard setting: ${meleeGuardName}`));
  let targetRuntimeName = findRuntimeProfile(groggyName, meleeGuardName);
  if (!targetRuntimeName) fail(t(`지원하지 않는 조합입니다: 그로기 ${groggyName}, 근접 방어 ${meleeGuardName}`, `Unsupported combination: groggy ${groggyName}, melee guard ${meleeGuardName}`));
  if (isGameRunning()) fail(t('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.', 'LET IT DIE is running. Close the game completely and try again.'));

  const status = readStatus(gameDirectory);
  assertSupported(status);
  if(manifest.steamBuildId==='25386710'&&!process.env.LID_SHARED_STAGE_BACKUP&&sharedLayers.FILES.every(f=>fs.existsSync(path.join(gameDirectory,f)))){
    const tx=sharedLayers.transact(gameDirectory,'guard',stage=>{
      return {result:applyScopedGuardFiles(stage,strengthName,groggyName,meleeGuardName)};
    },{compact:true});
    return {changed:tx.changed,backupPath:tx.backup,status:readStatus(gameDirectory)};
  }
  if (manifest.groggy.profiles[status.groggy.profile].warpCentered && manifest.groggy.profiles[targetRuntimeName + '-centered']) {
    targetRuntimeName += '-centered';
  }
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
    let targetGroggyHash = groggyProfile.sha1;
    if (status.groggy.embeddedM2g) {
      targetGroggyHash = makeEmbeddedTemp(status.paths.groggy, manifest.groggy.profiles[status.groggy.profile], groggyProfile, temps.groggy, status.groggy.m2g);
    } else if (status.groggy.m2g) {
      targetGroggyHash = makeM2gPatchedTemp(status.paths.groggy, manifest.groggy.profiles[status.groggy.profile], groggyProfile, temps.groggy);
    } else {
      makePatchedTemp(status.paths.groggy, manifest.groggy.profiles[status.groggy.profile], groggyProfile, manifest.groggy.size, temps.groggy);
    }
    makeExecutableTemp(status.paths.executable, commonProfile.sha1, targetGroggyHash, temps.executable);
    transactionalReplace(FILE_KEYS.map((key) => ({ target: status.paths[key], temp: temps[key] })));
  } catch (error) {
    cleanupFiles(Object.values(temps));
    error.message += t(`\n변경 전 백업: ${backupPath}`, `\nPre-change backup: ${backupPath}`);
    throw error;
  }

  const verified = readStatus(gameDirectory);
  restoreSafety.mark(backupPath, gameDirectory);
  if (verified.common.profile !== strengthName || verified.groggy.profile !== targetRuntimeName || !!verified.groggy.m2g !== !!status.groggy.m2g || !executableIsValid(verified)) {
    fail(t(`적용 후 검증에 실패했습니다. 변경 전 백업: ${backupPath}`, `Post-apply verification failed. Pre-change backup: ${backupPath}`));
  }
  return { changed: true, backupPath, status: verified };
}

function restoreBackup(gameDirectory, backupPath) {
  if(sharedLayers.isBackup(backupPath))return {...sharedLayers.restore(gameDirectory,backupPath),status:readStatus(gameDirectory)};
  if(sharedLayers.active(gameDirectory))fail(t('공통 레이어가 활성화된 상태에서는 구형 전체 백업을 덮어쓰지 않습니다. 가드를 순정으로 설정하거나 공통 백업을 사용하세요.','Legacy full restore is blocked while shared layers are active. Set guard to stock or use a shared backup.'));
  if (isGameRunning()) fail(t('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.', 'LET IT DIE is running. Close the game completely and try again.'));
  const metadata = readAndValidateBackup(backupPath);
  const current = readStatus(gameDirectory);
  if ((metadata.steamBuildId || null) !== (manifest.steamBuildId || null)) fail(t('게임 업데이트 전후의 백업은 서로 복원할 수 없습니다. 현재 빌드에서 만든 백업을 선택하세요.', 'Backups cannot be restored across game builds. Select a backup from the current build.'));
  restoreSafety.assertSafe(metadata, gameDirectory);
  const safetyBackup = createBackup(current, `before-restore:${path.basename(backupPath)}`);
  const temps = {};
  try {
    for (const key of FILE_KEYS) {
      temps[key] = `${current.paths[key]}.lid-jg.tmp`;
      if (fs.existsSync(temps[key])) fail(t(`이전 작업의 임시 파일이 남아 있습니다: ${temps[key]}`, `A temporary file from a previous operation remains: ${temps[key]}`));
      fs.copyFileSync(path.join(backupPath, metadata.files[key].name), temps[key], fs.constants.COPYFILE_EXCL);
      if (sha1File(temps[key]) !== metadata.files[key].sha1) fail(t(`복원 임시 파일 검증 실패: ${temps[key]}`, `Restore temporary-file verification failed: ${temps[key]}`));
    }
    transactionalReplace(FILE_KEYS.map((key) => ({ target: current.paths[key], temp: temps[key] })));
  } catch (error) {
    cleanupFiles(Object.values(temps));
    error.message += t(`\n복원 직전 안전 백업: ${safetyBackup}`, `\nPre-restore safety backup: ${safetyBackup}`);
    throw error;
  }

  for (const key of FILE_KEYS) {
    if (sha1File(current.paths[key]) !== metadata.files[key].sha1) {
      fail(t(`복원 후 ${key} 파일 검증에 실패했습니다. 안전 백업: ${safetyBackup}`, `File ${key} verification failed after restore. Safety backup: ${safetyBackup}`));
    }
  }
  restoreSafety.mark(safetyBackup, gameDirectory);
  return { backupPath, safetyBackup, status: readStatus(gameDirectory) };
}

function parseCommandLine(argv) {
  const positional = [];
  let gameDirectory;
  let yes = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--game') {
      if (!argv[index + 1]) fail(t('--game 뒤에 설치 폴더가 필요합니다.', '--game requires an installation folder.'));
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
  console.log(t('\n저스트가드 강도', '\nJust Guard strength'));
  STRENGTH_ORDER.forEach((name, index) => {
    const item = manifest.common.profiles[name];
    if (t(false, true)) {
      console.log(`${index + 1}. ${strengthDisplay(name)} — ready ${Math.round(item.guardReady * 1000)}ms / start ${Math.round(item.start * 1000)}ms / duration ${item.duration.toFixed(3)}s${item.probabilityUnlocked ? ' / high-tier weapon restriction removed' : ''}`);
      return;
    }
    console.log(`${index + 1}. ${item.label} — 준비 ${Math.round(item.guardReady * 1000)}ms / 시작 ${Math.round(item.start * 1000)}ms / 유지 ${item.duration.toFixed(3)}초` +
      `${item.probabilityUnlocked ? ' / 고급 무기 제한 해제' : ''}`);
  });
}

async function interactive(gameDirectory, rl) {
  while (true) {
    const status = readStatus(gameDirectory);
    printStatus(status);
    console.log(t('\n1. 설정 적용', '\n1. Apply settings'));
    console.log(t('2. 현재 게임 파일 백업', '2. Back up current game files'));
    console.log(t('3. 최신 백업 복원', '3. Restore latest backup'));
    console.log(t('4. 종료', '4. Exit'));
    const choice = (await rl.question(t('선택: ', 'Select: '))).trim();

    if (choice === '4') return;
    if (choice === '1') {
      assertSupported(status);
      printStrengthChoices();
      const strengthChoice = Number((await rl.question(t('강도 선택: ', 'Select strength: '))).trim());
      const strength = STRENGTH_ORDER[strengthChoice - 1];
      if (!strength) {
        console.log(t('잘못된 선택입니다.', 'Invalid selection.'));
        continue;
      }
      console.log(t('\n그로기 판정', '\nGroggy effect'));
      console.log(t('1. OFF — 순정 Flip 반응', '1. OFF — stock Flip response'));
      console.log(t('2. ON — 직접 공격한 상대를 정식 Groggy 상태로', '2. ON — put the direct attacker into the Groggy state'));
      const groggyChoice = Number((await rl.question(t('그로기 선택: ', 'Select groggy: '))).trim());
      const groggy = GROGGY_ORDER[groggyChoice - 1];
      if (!groggy) {
        console.log(t('잘못된 선택입니다.', 'Invalid selection.'));
        continue;
      }
      console.log(t('\n근접무기 저스트가드 불가 제한', '\nMelee Just Guard restrictions'));
      console.log(t('1. OFF — 순정 제한 유지', '1. OFF — preserve stock restrictions'));
      console.log(t('2. ON — 직접 근접 공격 제한 해제 + 성공 시 화염·전기·독 후속 피해 차단', '2. ON — remove direct melee restrictions + block follow-up fire/electric/poison damage on success'));
      const meleeGuardChoice = Number((await rl.question(t('근접무기 방어 선택: ', 'Select melee guard: '))).trim());
      const meleeGuard = MELEE_GUARD_ORDER[meleeGuardChoice - 1];
      if (!meleeGuard) {
        console.log(t('잘못된 선택입니다.', 'Invalid selection.'));
        continue;
      }
      const strengthLabel = strengthDisplay(strength);
      if (!await confirm(rl, t(`${strengthLabel} / 그로기 ${groggy.toUpperCase()} / 근접 방어 ${meleeGuard.toUpperCase()}를 적용할까요?`, `Apply ${strengthLabel} / groggy ${groggy.toUpperCase()} / melee guard ${meleeGuard.toUpperCase()}?`), false)) continue;
      const result = applySettings(gameDirectory, strength, groggy, meleeGuard);
      console.log(result.changed ? t(`\n적용 완료\n백업: ${result.backupPath}`, `\nApplied\nBackup: ${result.backupPath}`) : t('\n이미 선택한 설정입니다.', '\nAlready using these settings.'));
      continue;
    }
    if (choice === '2') {
      if (isGameRunning()) fail(t('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.', 'LET IT DIE is running. Close the game completely and try again.'));
      const backupPath = createBackup(status, 'manual');
      console.log(t(`\n백업 완료: ${backupPath}`, `\nBackup created: ${backupPath}`));
      continue;
    }
    if (choice === '3') {
      const backups = listBackups(gameDirectory);
      if (backups.length === 0) {
        console.log(t('\n복원할 백업이 없습니다.', '\nNo backup available to restore.'));
        continue;
      }
      const latest = backups[0];
      const info = readAndValidateBackup(latest);
      console.log(t(`\n복원 대상: ${latest}`, `\nRestore target: ${latest}`));
      console.log(t(`생성 시각: ${info.createdAt}`, `Created: ${info.createdAt}`));
      console.log(t(`사유: ${info.reason}`, `Reason: ${info.reason}`));
      if (!await confirm(rl, sharedLayers.isBackup(latest)?t('공통 백업의 게임 파일 6개와 모드 기록을 복원할까요?', 'Restore six game files and mod state from the shared backup?'):t('이 백업으로 게임 파일 3개를 복원할까요?', 'Restore the three game files from this backup?'), false)) continue;
      const result = restoreBackup(gameDirectory, latest);
      console.log(t(`\n복원 완료: ${result.backupPath}`, `\nRestored: ${result.backupPath}`));
      console.log(t(`복원 직전 안전 백업: ${result.safetyBackup}`, `Pre-restore safety backup: ${result.safetyBackup}`));
      continue;
    }
    console.log(t('잘못된 선택입니다.', 'Invalid selection.'));
  }
}

async function main() {
  const parsed = parseCommandLine(configure(process.argv.slice(2), __dirname));
  const command = String(parsed.positional[0] || '').toLowerCase();
  const interactiveMode = !command;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const gameDirectory = await require('./game-path').choose({input:parsed.gameDirectory,detect:()=>discoverGameDirectory(),files:[manifest.common.relativePath,manifest.groggy.relativePath,manifest.executable.relativePath],ask:q=>rl.question(q),interactive:interactiveMode||Boolean(process.stdin.isTTY),t});
    if (interactiveMode) {
      await interactive(gameDirectory, rl);
      return;
    }
    if (command === 'status') {
      printStatus(readStatus(gameDirectory));
      return;
    }
    if (command === 'repair-guard-state') {
      if (isGameRunning()) fail(t('LET IT DIE를 완전히 종료한 뒤 다시 실행하세요.', 'Close LET IT DIE completely and try again.'));
      if (!await confirm(rl, t('확인된 가드 스크립트의 잘못된 점프를 수정할까요?', 'Repair the identified incorrect guard-script jumps?'), parsed.yes)) return;
      const result = require('./guard-state-repair').repair(gameDirectory, path.join(__dirname, 'backups'));
      console.log(result.changed ? t(`가드 분기 수정 완료. 변경 전 백업: ${result.backupPath}`, `Guard branches repaired. Pre-change backup: ${result.backupPath}`) : t('이미 수정되어 있습니다.', 'Already repaired.'));
      return;
    }
    if (command === 'backup') {
      if (isGameRunning()) fail(t('LET IT DIE가 실행 중입니다. 게임을 완전히 종료한 뒤 다시 실행하세요.', 'LET IT DIE is running. Close the game completely and try again.'));
      const backupPath = createBackup(readStatus(gameDirectory), 'manual-cli');
      console.log(t(`백업 완료: ${backupPath}`, `Backup created: ${backupPath}`));
      return;
    }
    if (command === 'apply') {
      const strength = String(parsed.positional[1] || '').toLowerCase();
      const groggy = String(parsed.positional[2] || '').toLowerCase();
      const meleeGuard = String(parsed.positional[3] || 'off').toLowerCase();
      if (!manifest.common.profiles[strength] || !GROGGY_ORDER.includes(groggy) || !MELEE_GUARD_ORDER.includes(meleeGuard)) {
        fail(t('사용법: apply [stock|soft|wide|iron] [그로기 off|on] [근접 방어 off|on]', 'Usage: apply [stock|soft|wide|iron] [groggy off|on] [melee guard off|on]'));
      }
      const status = readStatus(gameDirectory);
      printStatus(status);
      if (!await confirm(rl, t(`${manifest.common.profiles[strength].label} / 그로기 ${groggy.toUpperCase()} / 근접 방어 ${meleeGuard.toUpperCase()}를 적용할까요?`, `Apply ${strengthDisplay(strength)} / groggy ${groggy.toUpperCase()} / melee guard ${meleeGuard.toUpperCase()}?`), parsed.yes)) return;
      const result = applySettings(gameDirectory, strength, groggy, meleeGuard);
      console.log(result.changed ? t(`적용 완료\n백업: ${result.backupPath}`, `Applied\nBackup: ${result.backupPath}`) : t('이미 선택한 설정입니다.', 'Already using these settings.'));
      return;
    }
    if (command === 'restore') {
      const backups = listBackups(gameDirectory);
      const backupPath = parsed.positional[1] ? path.resolve(parsed.positional[1]) : backups[0];
      if (!backupPath) fail(t('복원할 백업이 없습니다.', 'No backup available to restore.'));
      readAndValidateBackup(backupPath);
      if (!await confirm(rl, t(`${backupPath} 백업을 복원할까요?`, `Restore backup ${backupPath}?`), parsed.yes)) return;
      const result = restoreBackup(gameDirectory, backupPath);
      console.log(t(`복원 완료: ${result.backupPath}`, `Restored: ${result.backupPath}`));
      console.log(t(`복원 직전 안전 백업: ${result.safetyBackup}`, `Pre-restore safety backup: ${result.safetyBackup}`));
      return;
    }
    fail(t('사용법: node lid-justguard.js [status | backup | apply 강도 그로기 근접방어 | restore] [--game 경로] [--yes]', 'Usage: node lid-justguard.js [status | backup | apply strength groggy meleeGuard | restore] [--game path] [--yes] [--lang ko|en]'));
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(t(`\n오류: ${error.userFacing ? error.message : (error.stack || error.message)}`, `\nError: ${error.userFacing ? error.message : (error.stack || error.message)}`));
  process.exitCode = 1;
});
