param(
 [Parameter(Mandatory=$true)][string]$StockGame,
 [Parameter(Mandatory=$true)][string]$Library,
 [Parameter(Mandatory=$true)][string]$OtherPatchRoot,
 [Parameter(Mandatory=$true)][string]$OutputRoot
)
$ErrorActionPreference='Stop'
$Library=(Resolve-Path $Library).Path
$env:PATH="$Library/runtimes/win-x64/native;$env:PATH"
[Runtime.InteropServices.NativeLibrary]::Load("$Library/runtimes/win-x64/native/nironcompress.dll")|Out-Null
[Reflection.Assembly]::LoadFrom("$Library/UPK.Utils.dll")|Out-Null
function Load-Package($file){
 $folder=[UPK.Utils.GameProfiles.PackageFolder]::Create((Split-Path $file),0)
 $g=[UPK.Utils.GameProfiles.Game]::FromXmlFile([IO.FileInfo]"$PSScriptRoot/GameProfile.xml")
 $g.SetPackageFolders([UPK.Utils.GameProfiles.PackageFolder[]]@($folder));$g.Initialize($g)
 $p=[UPK.Utils.Packages.UPKPackage]::GetPackage([IO.FileInfo]$file,$folder)
 $p.ReadHeader([UPK.Utils.GameProfiles.Platforms]::PC,[UPK.Utils.Compressions.CompressionFlag]::LZO,'')
 return @{p=$p;g=$g}
}
$root=Join-Path $OutputRoot ('guard-options-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $root|Out-Null
foreach($variant in @('common-soft','common-wide','common-iron','groggy-off-on','groggy-on-off','groggy-on-on')){
 $common=$variant.StartsWith('common')
 $file=if($common){'AS_CH_Main_Male_Common_SF.upk'}else{'BrgGame.upk'}
 $loaded=Load-Package "$StockGame/BrgGame/CookedPCConsole/$file"
 $adapter=[UPK.Utils.Adapters.PackageAdapter]::new($loaded.p,[UPK.Utils.ObjectDescriptors.ObjectDescriptors]::CreateDefault(),$loaded.g)
 $dir=Join-Path $root $variant;New-Item -ItemType Directory $dir|Out-Null
 $updater=[UPK.Utils.Adapters.Updaters.PackageUpdater]::new($adapter,$loaded.p,$dir)
 $patchFiles=@("$PSScriptRoot/options/$variant.PackagePatch")
 if(!$common){foreach($other in @('02-Tengoku-Warp','03-M2G-Knife','04-Vending')){$patchFiles+=,"$OtherPatchRoot/$other/Game/BrgGame/CookedPCConsole/BrgGame.PackagePatch"}}
 $expected=@{}
 foreach($patchFile in $patchFiles){
  $patch=[UPK.Utils.GamePatches.PackagePatch]::new();$patch.Read($patchFile,$loaded.p.Profile)
  foreach($o in $patch.ObjectUpdates){
   $index=[int]$o.ObjectExportIndex;if($expected.ContainsKey($index)){throw "Overlapping object $index"}
   if(@($o.LocalOffsetRecords).Count){throw 'Unexpected relocation records'}
   $expected[$index]=[byte[]]$o.SerializedData
  }
  $updater.ApplyPatch($patch,$false)|Out-Null
 }
 $output=Join-Path $dir $file
 $updater.Write([IO.FileInfo]$output,[UPK.Utils.Compressions.CompressionSettings]::CreateDefault([UPK.Utils.Compressions.CompressionFlag]::LZO,$loaded.p.Profile),$null)
 $check=Load-Package $output
 foreach($index in $expected.Keys){
  $range=$check.p.ObjectExports[$index].SerializedData;$bytes=$check.p.CreateDataReader($range.Offset).ReadBytes($range.Size)
  if([Convert]::ToBase64String($bytes) -ne [Convert]::ToBase64String($expected[$index])){throw "Payload mismatch $variant/$index"}
 }
 Write-Output "$variant verified via TFC: $($expected.Count) preserved object payloads"
}
Write-Output "All six option patches validated on copies only: $root"
