var macroSteps = [];

function recordMacro() {
  macroSteps = []; // clear previous macro steps
  
  var doc = app.activeDocument;
  var sel = doc.selection;

  alert('Recording macro. Perform the actions you want to record, then click OK to stop recording.');

  while (confirm('Do you want to add this step to the macro?')) {
    macroSteps.push(sel); // add current selection to macro steps
    alert('Step recorded.');
  }

  alert('Macro recording complete.');
}

function playMacro() {
  if (macroSteps.length == 0) {
    alert('No macro steps recorded.');
    return;
  }

  var doc = app.activeDocument;

  for (var i = 0; i < macroSteps.length; i++) {
    doc.selection = macroSteps[i]; // select saved selection
    alert('Playing step ' + (i + 1) + ' of ' + macroSteps.length);
  }

  alert('Macro playback complete.');
}
