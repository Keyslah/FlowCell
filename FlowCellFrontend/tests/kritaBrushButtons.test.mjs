import test from "node:test";
import assert from "node:assert/strict";
import { applySavedBrushLabels } from "./.compiled-button-system/button/state/kritaBrushButtonOperations.js";

test("resaving a brush updates its copies without relocating panels or replacing custom labels", () => {
  const document = { buttons: {
    original: {label:"Ink · 20 px",metadata:{kritaBrushId:"ink",kritaBrushLabel:"Ink · 20 px"},sourceIdentity:{displayPanelName:"Brushes"}},
    copy: {label:"Ink · 20 px",metadata:{kritaBrushId:"ink",kritaBrushLabel:"Ink · 20 px"},sourceIdentity:{displayPanelName:"Portraits"}},
    custom: {label:"Eyebrows",metadata:{kritaBrushId:"ink",kritaBrushLabel:"Ink · 20 px"},sourceIdentity:{displayPanelName:"Details"}},
    other: {label:"Pencil",metadata:{kritaBrushId:"pencil"}}
  }, placements:{copy:{x:14,y:21}}, skins:{custom:"untouched"} };
  const other = structuredClone(document.buttons.other);
  applySavedBrushLabels(document,{id:"ink",revision:"new",label:"Ink · 37.25 px"});
  assert.equal(document.buttons.original.label,"Ink · 37.25 px");
  assert.equal(document.buttons.copy.label,"Ink · 37.25 px");
  assert.equal(document.buttons.copy.sourceIdentity.displayPanelName,"Portraits");
  assert.equal(document.buttons.custom.label,"Eyebrows");
  assert.equal(document.buttons.custom.metadata.kritaBrushRevision,"new");
  assert.deepEqual(document.buttons.other,other);
  assert.deepEqual(document.placements,{copy:{x:14,y:21}});
  assert.deepEqual(document.skins,{custom:"untouched"});
});
