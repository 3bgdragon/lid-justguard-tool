# Just Guard — TFC edition

## v1.1.1 installer fix

Fixes `Updated 0 file(s)` caused by missing `.upk` in patch filenames. TFC strips only `.PackagePatch`, so the installed target must be named `BrgGame.upk.PackagePatch`, not `BrgGame.PackagePatch`. Removes the leftover disposable-test display label.

Download this new ZIP. Guard users must regenerate presets using the new generator; old generated folders keep the incorrect names. A 0-file result is not a successful installation. Do not use **Uninstall all** merely to address this error, as it removes other mods too.

[한국어 사용법](START-HERE.ko.md)

**TFC-only release: tfc-v1.1.1.** Download the attached `*-tfc-v1.1.1.zip` asset, not GitHub's source-code ZIP.
This ZIP has its own launcher and runtime. The standalone release and root launcher are a different distribution and are not included here.

Steam build **25386710**. Requires Node.js **22.13+** and TFC Installer **2.5.6.0**.

Timing, Groggy and melee protection are selectable; elemental follow-up protection currently follows melee.

## Install

Close the game and back up your save. Remove standalone patches with their original tools before switching; do not mix installation modes.

1. Optional: run **configure-guard-tfc.bat in the original TFC download** to generate a chosen guard preset. Otherwise use the default folder (soft 0.5 s, Groggy ON, melee protection ON).
2. Install the **chosen mod folder** through TFC.
3. Run **run-tfc.bat in that same folder → 1. Finish installation**.
Launch the game after completion. Enter the game folder or BrgGame-Steam.exe path when asked.
Finish installation performs the required hash relinking and native setup together; no additional Sync step is needed.

## Remove / change preset

Remove the UPK mod with TFC while the game is closed, then run its **run-tfc.bat → 2. Finish removal**.
To change settings: generate a new folder → remove the previous guard preset in TFC → install the new folder → its run-tfc.bat option 1. Never stack guard presets. All stock means removing the guard mod.

## Troubleshooting only

- **3. Check connection**: checks EXE links; not a full gameplay or UPK-preset status report.
- **4. Advanced**: refresh hash links after another TFC UPK mod changes files, restore previous native settings, or recover an interrupted operation.

All needed runtime files are inside `tfc/` or the generated mod folder. Companion does not rewrite UPKs or saves.
TFC manages UPK backups; companion manages EXE/DB settings. Backups are at `<game-parent>/LET-IT-DIE-TFC-backups`.
Keep `<game>/LID-TFC-State`; never delete receipts manually. Purchases, decals and ammo/save changes are not undone.
Each mod's UPK payloads remain separate. Foreign edits to the same objects can conflict.

See [COMPANION.md](COMPANION.md) for recovery details and [VALIDATION.md](VALIDATION.md) for test coverage.
