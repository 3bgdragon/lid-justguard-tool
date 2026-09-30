# LET IT DIE Just Guard Tool

[English](README.md) | [한국어](README.ko.md)

Configures Just Guard timing, groggy reactions, melee guard restrictions and elemental follow-up protection.

## Requirements

- Steam offline edition of LET IT DIE on Windows.
- Node.js 18 or newer. No npm install is needed for normal use.
- Support is determined by file/schema checks, not just the displayed game version. Never bypass an unsupported-file error.

## Installation

1. Use **Code → Download ZIP**, then extract the archive.
2. Back up your save separately and close the game completely.
3. Run `run-en.bat` for English, or use `run.bat --lang ko` for Korean. If Windows denies Steam-folder write access, run the launcher as administrator.
4. Read confirmations carefully and keep every backup created by the tool.

English: `node --no-warnings lid-justguard.js --lang en`.
Korean: `node --no-warnings lid-justguard.js --lang ko`.
Run these commands in an administrator terminal if Steam-folder access is denied. Without an explicit language, the tool reads the parent folder's `let-it-die-tool-settings.json` preference, then defaults to Korean.

## Important behavior

Changes game packages and executable hash links. Only recognized builds and patch combinations are supported. Read the build-specific timing and compatibility notes in the Korean guide.

## Backups and compatibility

Do not delete an older tool folder until its backups have been preserved. Backups are local files, not stored on GitHub. Restoring game files does not undo purchased items, spent currency or subsequent save changes. Compatibility with every other mod or installation order is not guaranteed.

## Translation status

CLI menus, status displays, confirmations and tool-generated runtime errors support English and Korean. File paths, hashes and stored settings are not translated. System errors follow Windows/Node.js language. This tool does not translate the game itself. Historical release notes remain in the [Korean guide](README.ko.md). Translation does not add support for new game builds.

## 1.8.1-dev compatibility fix

Steam build 25386710 now includes all eight M2G knife-only combinations and four warp-preserving guard profiles. Changing guard settings retains the current M2G firing mode and the Tengoku selector, including its English labels. The bundled M2G rebuild code uses the correct function layout for this build. Use warp tool 1.4.1-dev or newer for the corresponding recognition fix.

Read-only source copies passed all 16 standalone guard settings and all six Warp / Just Guard / M2G installation orders. Combined files were identical across orders; reverse selective removal restored the originals and later cross-mod changes blocked old full-backup restoration. This validates file compatibility, not new in-game combat testing.

For support, include tool version, game build, exact error and relevant logs. Avoid publishing your entire save or unnecessary account identifiers.
