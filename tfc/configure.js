'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const catalog=require('./options/manifest.json');
const STRENGTHS={stock:{ready:0.063333377,start:0.102666996,duration:0.104},soft:{ready:0.04,start:0.06,duration:0.5},wide:{ready:0.025,start:0.035,duration:1},iron:{ready:0.015,start:0.02,duration:1.2}};
function validate(input){
 if(!input||!Object.hasOwn(STRENGTHS,input.strength)||typeof input.groggy!=='boolean'||typeof input.melee!=='boolean'||typeof input.elemental!=='boolean')throw Error('Invalid guard configuration / 가드 설정 오류');
 // Existing reviewed bytecode bundles these protections. Never fabricate an independent toggle.
 if(input.elemental!==input.melee)throw Error('Independent elemental protection is not verified yet. Set elemental and melee together. / 속성 피해 차단의 독립 설정은 아직 검증되지 않았습니다. 현재는 근접 방어와 함께 켜거나 꺼야 합니다.');
 return {strength:input.strength,groggy:input.groggy,melee:input.melee,elemental:input.elemental};
}
function generate(input,outputRoot=path.join(__dirname,'generated')){
 const config=validate(input);
 if(config.strength==='stock'&&!config.groggy&&!config.melee)throw Error('All stock: remove the guard UPK patch in TFC, then Sync hashes. / 모두 순정이면 TFC에서 가드 패치를 제거한 뒤 해시 연결을 실행하세요.');
 const source=__dirname,patches=[];
 if(config.strength!=='stock')patches.push(['common-'+config.strength+'.PackagePatch','AS_CH_Main_Male_Common_SF.PackagePatch']);
 if(config.groggy||config.melee)patches.push(['groggy-'+(config.groggy?'on':'off')+'-'+(config.melee?'on':'off')+'.PackagePatch','BrgGame.PackagePatch']);
 const verified=patches.map(([file,target])=>{
  const bytes=fs.readFileSync(path.join(source,'options',file)),expected=catalog.assets[file];
  if(!expected||bytes.length!==expected.size||crypto.createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw Error('Option patch damaged: '+file);
  return {bytes,target};
 });
 const output=path.join(path.resolve(outputRoot),'guard-'+config.strength+'-g'+Number(config.groggy)+'-m'+Number(config.melee)+'-'+crypto.randomUUID());
 fs.mkdirSync(output,{recursive:true});
 try{
  const game=path.join(output,'Game/BrgGame/CookedPCConsole');fs.mkdirSync(game,{recursive:true});
  for(const patch of verified)fs.writeFileSync(path.join(game,patch.target),patch.bytes);
  for(const name of ['runtime','GameProfile.xml','companion.js','run-tfc.bat','COMPANION.md','START-HERE.ko.md'])fs.cpSync(path.join(source,name),path.join(output,name),{recursive:true});
  fs.writeFileSync(path.join(output,'ModInfo.xml'),'<ModInfo name="Just Guard '+config.strength+' / Groggy '+config.groggy+' / Melee '+config.melee+' / Elemental '+config.elemental+' — build 25386710" />\n');
  fs.writeFileSync(path.join(output,'settings.json'),JSON.stringify({build:'25386710',...config,timing:STRENGTHS[config.strength],elementalIndependent:false},null,2)+'\n');
  fs.writeFileSync(path.join(output,'README.txt'),'Close the game. REMOVE the old guard UPK mod with TFC, then install THIS folder and run run-tfc.bat -> 1. Finish installation. Do not stack guard presets. Other TFC mods should remain installed.\n게임 종료 후 TFC에서 이전 가드 모드를 제거하고 이 폴더를 적용한 뒤 run-tfc.bat -> 1번 설치 마무리를 실행하세요. 가드 프리셋은 중복 적용하지 마세요.\nElemental protection currently follows melee protection; independent combinations are rejected.\n속성 피해 차단은 현재 근접 방어와 연동되며, 독립 조합은 생성하지 않습니다.\n');
  return {output,config};
 }catch(error){error.message+='\nIncomplete generated folder (do not install): '+output;throw error;}
}
async function main(){
 const {parseArgs}=require('node:util');
 const {values}=parseArgs({options:{strength:{type:'string'},groggy:{type:'string'},melee:{type:'string'},elemental:{type:'string'},output:{type:'string'}}});
 let input;
 if(values.strength){
  const bool=(value,name)=>{if(!['on','off'].includes(value))throw Error(name+' must be on/off');return value==='on';};
  input={strength:values.strength,groggy:bool(values.groggy,'groggy'),melee:bool(values.melee,'melee'),elemental:bool(values.elemental,'elemental')};
 }else{
  const rl=require('node:readline/promises').createInterface({input:process.stdin,output:process.stdout});
  try{
   console.log('TFC guard patch generator / TFC 가드 옵션 패치 생성\nNo game files are changed. / 게임 파일은 변경하지 않습니다.');
   const strength={'1':'stock','2':'soft','3':'wide','4':'iron'}[(await rl.question('1. Stock 0.104s / 순정\n2. Soft 0.5s / 완화\n3. Wide 1.0s / 넓게\n4. Iron 1.2s / 다리미급\nTiming / 판정 시간: ')).trim()];
   const choose=async label=>{const reply=(await rl.question(label+' [1=OFF, 2=ON]: ')).trim();if(!['1','2'].includes(reply))throw Error('Choose 1 or 2');return reply==='2';};
   const groggy=await choose('Groggy / 그로기'),melee=await choose('Melee restrictions removed / 근접 방어 제한 해제');
   console.log('Elemental follow-up protection currently follows melee: '+(melee?'ON':'OFF')+' / 속성 후속 피해 차단은 현재 근접 방어와 연동됩니다.');
   input={strength,groggy,melee,elemental:melee};
  }finally{rl.close();}
 }
 const result=generate(input,values.output);console.log('Generated TFC mod folder / 생성된 TFC 모드 폴더:\n'+result.output+'\nRemove the old guard preset in TFC before installing this folder. / TFC에서 기존 가드 프리셋 제거 후 이 폴더를 적용하세요.');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={validate,generate,STRENGTHS};
