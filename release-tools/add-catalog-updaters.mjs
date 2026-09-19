/* Purpose: Author/validate required updater contributions for publishable program manifests.
 * Context: Repository root, Node at author/build time only. Inputs: tracked program manifests.
 * --write creates updater packages and optional Files contributions; default validates.
 * Changes only declared catalogs, manifest contribution inventory and baseline placeholders.
 * No deletion, user state, runtime installation, or arbitrary-local-program validation.
 * Unknown runners fail closed until an appropriate compatible entry template is supplied.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root = path.resolve(import.meta.dirname,'..');
const template = path.join(import.meta.dirname,'catalog-updater');
const write = process.argv.includes('--write');
const tracked = execFileSync('git',['-c','core.quotePath=false','ls-files','-z','--','Programs'],{cwd:root,encoding:'utf8'}).split('\0');
const manifests = tracked.filter(p=>/^Programs\/[^/]+\/flowcell\.program\.json$/.test(p));
function read(p){return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));}
function save(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');}
function assert(value,message){if(!value)throw new Error(message);}
function safe(base,p){assert(typeof p==='string' && p && !p.includes('\\') && !p.split('/').some(s=>!s||s==='..'||s==='.') && !path.isAbsolute(p),'Unsafe manifest folder');const out=path.resolve(base,p);assert(out.startsWith(path.resolve(base)+path.sep),'Path escaped package');return out;}
for(const relative of manifests){
  const manifestPath=path.join(root,relative), m=read(manifestPath), program=path.dirname(manifestPath);
  const entries={'windows-script':'update_catalog.ps1','blender-bridge':'update_catalog.py','fusion-bridge':'update_catalog.py','illustrator-direct':'update_catalog.jsx'};
  const entry=entries[m.runner.kind];
  assert(entry,`${relative}: supply a compatible updater template for ${m.runner.kind}`);
  assert(m.allowedScriptExtensions.includes(entry.split('.').pop()),`${relative}: updater entry is incompatible with runner`);
  const sourcePath=m.gitScriptsFolder+'/Files/Update Git Scripts';
  const packageRoot=safe(program,sourcePath);
  const contribution={id:m.programId+'.update-git-scripts',version:'1.0.0',panelName:'Files',sourcePath,importKind:'script',displayLabel:'Update Git Scripts',sourceKind:'script',required:false,dependencies:[],installEffects:['Downloads this program catalog only; preserves local edits and installed Buttons.'],installOnAdd:true};
  const files=['Update-Catalog.ps1',entry,...(entry.endsWith('.jsx')?['launch_updater.vbs']:[])];
  const metadata={schemaVersion:1,programId:m.programId,repository:'Keyslah/FlowCell',ref:'FlowCell',catalogPath:path.posix.dirname(relative)+'/'+m.gitScriptsFolder};
  if(write){
    fs.mkdirSync(packageRoot,{recursive:true});
    for(const file of files)fs.copyFileSync(path.join(template,file),path.join(packageRoot,file));
    save(path.join(packageRoot,'flowcell.script.json'),{schemaVersion:1,id:contribution.id,label:'Update Git Scripts',tooltip:'Download the latest available scripts for this program. Installed Buttons and local edits are preserved.',program:m.label,source:entry});
    save(path.join(packageRoot,'updater.json'),metadata);
    if(!m.panels.some(p=>p.label==='Files'))m.panels.push({id:'files',label:'Files',defaultSelected:true});
    if(!m.defaultPanels.includes('Files'))m.defaultPanels.push('Files');
    const existing=m.bundledSources.findIndex(s=>s.id===contribution.id);
    if(existing>=0)m.bundledSources[existing]=contribution;else m.bundledSources.push(contribution);
    save(manifestPath,m);
    const baseline=safe(program,m.supportScriptsFolder+'/catalog-baseline.json');
    if(!fs.existsSync(baseline))save(baseline,{schemaVersion:1,programId:m.programId,files:{}});
  }
  const selected=m.bundledSources.filter(s=>s.id===contribution.id);
  assert(selected.length===1,`${relative}: missing required Update Git Scripts contribution`);
  const s=selected[0];
  assert(s.panelName==='Files' && s.sourcePath===sourcePath && s.installOnAdd===true && !s.installIfMissing && !s.required && s.importKind==='script' && s.sourceKind==='script',`${relative}: invalid optional updater contribution`);
  assert(m.panels.some(p=>p.label==='Files'),`${relative}: missing Files setup inventory`);
  const pm=read(path.join(packageRoot,'flowcell.script.json'));
  assert(pm.source===entry && pm.label==='Update Git Scripts' && pm.program===m.label,`${relative}: invalid updater package manifest`);
  assert(JSON.stringify(read(path.join(packageRoot,'updater.json')))===JSON.stringify(metadata),`${relative}: wrong published source metadata`);
  for(const file of files){
    const delivered=path.join(packageRoot,file);
    assert(fs.existsSync(delivered),`${relative}: missing updater dependency ${file}`);
    assert(fs.readFileSync(delivered,'utf8').replace(/\r\n/g,'\n')===fs.readFileSync(path.join(template,file),'utf8').replace(/\r\n/g,'\n'),`${relative}: updater template drift in ${file}`);
  }
  assert(read(safe(program,m.supportScriptsFolder+'/catalog-baseline.json')).programId===m.programId,`${relative}: missing baseline placeholder`);
  console.log(`Validated updater: ${m.label} (${m.runner.kind})`);
}
assert(manifests.length>0,'No publishable program manifests found');
