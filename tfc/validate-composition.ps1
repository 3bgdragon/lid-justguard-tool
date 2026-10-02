param(
 [Parameter(Mandatory=$true)][string]$InputGame,
 [Parameter(Mandatory=$true)][string]$PatchRoot,
 [Parameter(Mandatory=$true)][string]$Library,
 [Parameter(Mandatory=$true)][string]$ProfilePath,
 [Parameter(Mandatory=$true)][string]$OutputRoot,
 [int]$Limit=24
)
$ErrorActionPreference='Stop'
$lib=(Resolve-Path $Library).Path
$env:PATH="$lib/runtimes/win-x64/native;$env:PATH"
[Runtime.InteropServices.NativeLibrary]::Load("$lib/runtimes/win-x64/native/nironcompress.dll")|Out-Null
[Reflection.Assembly]::LoadFrom("$lib/UPK.Utils.dll")|Out-Null
function Load-Package($file) {
 $folder=[UPK.Utils.GameProfiles.PackageFolder]::Create((Split-Path $file),0)
 $g=[UPK.Utils.GameProfiles.Game]::FromXmlFile([IO.FileInfo]"$ProfilePath")
 $g.SetPackageFolders([UPK.Utils.GameProfiles.PackageFolder[]]@($folder));$g.Initialize($g)
 $p=[UPK.Utils.Packages.UPKPackage]::GetPackage([IO.FileInfo]$file,$folder)
 $p.ReadHeader([UPK.Utils.GameProfiles.Platforms]::PC,[UPK.Utils.Compressions.CompressionFlag]::LZO,'')
 return @{p=$p;g=$g}
}
function Orders($items) {
 if($items.Count -eq 1){return [string]$items[0]}
 foreach($i in $items){foreach($tail in (Orders @($items|Where-Object {$_ -ne $i}))){"$i,$tail"}}
}
$base=(Resolve-Path "$InputGame/BrgGame/CookedPCConsole/BrgGame.upk").Path
$patches=@{};$expected=@{};$pkg=Load-Package $base
foreach($name in @('guard','warp','m2g','vending')) {
 $patch=[UPK.Utils.GamePatches.PackagePatch]::new()
 $patch.Read("$PatchRoot/$name/tfc2/Game/BrgGame/CookedPCConsole/BrgGame.PackagePatch",$pkg.p.Profile)
 $patches[$name]=$patch
 foreach($o in $patch.ObjectUpdates) {
  $index=[int]$o.ObjectExportIndex
  if($expected.ContainsKey($index)){throw "Object overlap at $index"}
  if(@($o.LocalOffsetRecords).Count){throw "Comparison requires relocation-aware handling: $index"}
  $expected[$index]=[byte[]]$o.SerializedData
 }
 Write-Output "$name exports: $(@($patch.ObjectUpdates.ObjectExportIndex) -join ',')"
}
$root=Join-Path $OutputRoot ('tfc-orders-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $root|Out-Null
$count=0
foreach($sequence in (Orders @('guard','warp','m2g','vending'))) {
 $order=$sequence.Split(',')
 if($count -ge $Limit){break};$count++
 $loaded=Load-Package $base
 $adapter=[UPK.Utils.Adapters.PackageAdapter]::new($loaded.p,[UPK.Utils.ObjectDescriptors.ObjectDescriptors]::CreateDefault(),$loaded.g)
 $dir=Join-Path $root ($order -join '-');New-Item -ItemType Directory $dir|Out-Null
 $updater=[UPK.Utils.Adapters.Updaters.PackageUpdater]::new($adapter,$loaded.p,$dir)
 foreach($name in $order){$updater.ApplyPatch($patches[$name],$false)|Out-Null}
 $out=Join-Path $dir 'BrgGame.upk'
 $updater.Write([IO.FileInfo]$out,[UPK.Utils.Compressions.CompressionSettings]::CreateDefault([UPK.Utils.Compressions.CompressionFlag]::LZO,$loaded.p.Profile),$null)
 $result=Load-Package $out
 foreach($index in $expected.Keys){
  $range=$result.p.ObjectExports[$index].SerializedData
  $bytes=$result.p.CreateDataReader($range.Offset).ReadBytes($range.Size)
  if([Convert]::ToBase64String($bytes) -ne [Convert]::ToBase64String($expected[$index])){throw "Object mismatch $index in $($order -join '-')"}
 }
 Write-Output "PASS $($order -join '-') / $($expected.Count) preserved objects"
}
Write-Output "Verified $count orders. Fixtures: $root"
