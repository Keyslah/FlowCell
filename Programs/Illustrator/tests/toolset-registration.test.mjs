import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('Add Program declares each Illustrator toolset in the dedicated Toolsets panel',()=>{
  const manifest=JSON.parse(readFileSync(path.join(root,'flowcell.program.json'),'utf8'));
  assert.ok(manifest.defaultPanels.includes('Toolsets'));
  assert.ok(manifest.panels.some(panel=>panel.label==='Toolsets'&&panel.defaultSelected));
  const catalog=path.join(root,'Illustrator Git Scripts','Toolsets');
  for(const entry of readdirSync(catalog,{withFileTypes:true}).filter(entry=>entry.isDirectory())){
    const relative=`Illustrator Git Scripts/Toolsets/${entry.name}/flowcell.toolset.json`;
    const toolset=JSON.parse(readFileSync(path.join(root,relative),'utf8'));
    const matches=manifest.bundledSources.filter(source=>source.id===toolset.id);
    assert.equal(matches.length,1,`${toolset.label} needs one declared contribution`);
    const source=matches[0];
    assert.equal(source.panelName,'Toolsets');
    assert.equal(source.sourcePath,relative);
    assert.equal(source.importKind,'tool-set');
    assert.equal(source.sourceKind,'tool-set');
    assert.equal(source.installOnAdd,true);
  }
});
