"""Rebase guard-only deltas after exact object checks; never writes game files."""
import ast, copy, contextlib, importlib.util, io, json, struct, sys
from pathlib import Path

repo = Path(__file__).resolve().parents[1]
workspace = repo.parent
warp = workspace / 'lid-tengoku-warp-tool'
sys.path[:0] = [str(workspace), str(warp / 'dev')]
from build_release_assets import *
from ue3_decompress import decompress_package
from ue3_inspect import Package
spec = importlib.util.spec_from_file_location('ik', warp / '.integration-temp/inspect-kismet.py')
ik = importlib.util.module_from_spec(spec); spec.loader.exec_module(ik)
stage = repo / '.integration-temp/build25386710'
assets = stage / 'assets'; assets.mkdir(parents=True, exist_ok=True)
tree = ast.parse((warp / 'dev/build_update25136512.py').read_text(encoding='utf-8'))
for node in tree.body:
    if isinstance(node, ast.FunctionDef) and node.name in ['pack_changes', 'xor_delta']:
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<verified-builder>', 'exec'))
game = Path(r'C:\Program Files (x86)\Steam\steamapps\common\LET IT DIE')
oldman = json.loads((repo / 'assets/manifest-25244463.json').read_text(encoding='utf-8'))
manifest = copy.deepcopy(oldman)
manifest.update(gameVersion='Steam build 25386710', steamBuildId='25386710')
inputs = {
    'common': (repo / '.integration-temp/build25244463-txdqyZ/game/BrgGame/CookedPCConsole/AS_CH_Main_Male_Common_SF.upk', '2E34F1F72B14B7D18AC701D87FFEBD14A63C94E4'),
    'groggy': (warp / '.integration-temp/build25244463/fixture-LeGmbf/BrgGame/CookedPCConsole/BrgGame.upk', 'C1C9738885B6672F61026A3767EAD65A08D7CD51'),
}
audit = {}
def audit_references(a, b, op, np):
    assert len(a) == len(b), 'Function length changed'
    normalized = bytearray(b); refs = {}
    for at in range(len(a)):
        if a[at] == normalized[at]: continue
        candidates = []
        for pos in range(max(0, at-3), at+1):
            if pos+4 > len(a): continue
            x, y = struct.unpack_from('<i',a,pos)[0], struct.unpack_from('<i',b,pos)[0]
            if x == y: continue
            prefix = a[pos-1] if pos else None
            if (pos in [4,len(a)-8] or prefix in [0x1b,0x21]) and pos+8<=len(a) and a[pos+4:pos+8]==b[pos+4:pos+8]:
                if 0<=x<len(op.names) and 0<=y<len(np.names) and op.names[x]==np.names[y]:
                    candidates.append((pos,'name',op.names[x]))
            if pos not in [4,len(a)-8] and (pos in [0,12,16,24] or prefix in [0x00,0x01,0x13,0x20,0x2d,0x2e,0x3a,0x1c]):
                if x and y and -len(op.imports)<=x<=len(op.exports) and -len(np.imports)<=y<=len(np.exports):
                    if op.object_path(x)==np.object_path(y): candidates.append((pos,'object',op.object_path(x)))
        assert len(candidates)==1, ('Unexplained/ambiguous function difference',at,candidates)
        pos,kind,name=candidates[0]
        normalized[pos:pos+4]=a[pos:pos+4];refs[pos]=(kind,name)
    assert normalized==a
    return refs

for kind, (oldfile, expected_new_hash) in inputs.items():
    newfile = game / oldman[kind]['relativePath']
    oldbase, newbase = oldfile.read_bytes(), newfile.read_bytes()
    basekey = 'stock' if kind == 'common' else 'off-off'
    assert sha1(oldbase) == oldman[kind]['profiles'][basekey]['sha1']
    assert sha1(newbase) == expected_new_hash
    packages = []
    for label, file in [('old', oldfile), ('new', newfile)]:
        logical = stage / f'{kind}-{label}.logical.upk'
        with contextlib.redirect_stdout(io.StringIO()): decompress_package(file, logical)
        p = Package(logical); p.exports = ik.read_variable_exports(p)
        packages.append((p, {p.object_path(i+1): e for i, e in enumerate(p.exports)}))
    (op, om), (np, nm) = packages
    manifest[kind]['profiles'] = {}
    manifest[kind]['size'] = len(newbase)
    for key, profile in oldman[kind]['profiles'].items():
        if profile.get('legacy') or profile.get('warpCentered'): continue
        patched = bytearray(oldbase.ljust(profile['size'], b'\0'))
        apply_xor(patched, read_lidxor(repo / 'assets' / profile['patch']))
        assert sha1(patched) == profile['sha1']
        changes = []; checked = set(); object_changes = {}
        for oldchunk, newchunk in zip(chunk_entries(oldbase), chunk_entries(patched)):
            lo, sz, po, ps = oldchunk; nlo, nsz, npo, nps = newchunk
            assert (lo, sz) == (nlo, nsz)
            if oldbase[po:po+ps] == patched[npo:npo+nps]: continue
            a = decompress_chunk(oldbase, po, sz); b = decompress_chunk(patched, npo, nsz)
            for rel, (x, y) in enumerate(zip(a, b)):
                if x == y: continue
                pos = lo + rel
                matches = [(name, e) for name, e in om.items() if e.serial_offset <= pos < e.serial_offset + e.serial_size]
                assert len(matches) == 1, (kind, key, pos)
                name, oe = matches[0]; ne = nm[name]
                oldserial = op.data[oe.serial_offset:oe.serial_offset+oe.serial_size]
                newserial = np.data[ne.serial_offset:ne.serial_offset+ne.serial_size]
                if name not in object_changes:
                    refs = audit_references(oldserial,newserial,op,np) if kind=='groggy' else {}
                    if kind=='common': assert oldserial==newserial,name
                    object_changes[name] = (oe,ne,oldserial,newserial,refs,{})
                checked.add(name)
                object_changes[name][-1][pos-oe.serial_offset]=y
        for name,(oe,ne,a,b,refs,edits) in object_changes.items():
            modified=bytearray(a)
            for at,value in edits.items():modified[at]=value
            consumed=set()
            for pos,(refkind,refname) in refs.items():
                if not any(i in edits for i in range(pos,pos+4)):continue
                assert refkind=='object',(name,pos,refkind)
                desired=op.object_path(struct.unpack_from('<i',modified,pos)[0])
                matches=[i+1 for i,e in enumerate(np.exports) if np.object_path(i+1)==desired]
                assert len(matches)==1,(name,desired)
                changes.append((ne.serial_offset+pos,b[pos:pos+4],struct.pack('<i',matches[0])))
                consumed.update(range(pos,pos+4))
            for at,value in edits.items():
                if at in consumed:continue
                assert a[at]==b[at],(name,at)
                changes.append((ne.serial_offset+at,bytes([a[at]]),bytes([value])))
        target, spans = pack_changes(newbase, changes)
        filename = f'25386710-{kind}-{key}.lidxor'
        xor_delta(filename, newbase, target, spans)
        manifest[kind]['profiles'][key] = dict(profile, sha1=sha1(target), patch=filename, size=len(target), xorBaseSize=len(newbase))
        audit[f'{kind}/{key}'] = dict(objects=sorted(checked), changedBytes=len(changes), sha1=sha1(target))
        print(kind, key, len(changes), sorted(checked), flush=True)
(assets / 'manifest-25386710.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
(stage / 'audit.json').write_text(json.dumps(audit, indent=2)+'\n', encoding='utf-8')
print('Staging complete; installation unchanged.', flush=True)
