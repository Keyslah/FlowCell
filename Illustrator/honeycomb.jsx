/**
 * Honeycomb Grid Generator (flat-topped hexes)
 * - Prompts:
 *   1) Hex flat-to-flat size in inches (e.g., 0.5)
 *   2) Target *square* size in inches (e.g., 10)
 * - Rounds UP the hex counts so: cols = ceil(square/hex), rows = ceil(square/hex)
 *   (So 0.5" hex + 10" square => 20 cols × 20 rows.)
 * - Draws grid on a new layer and reports the actual coverage in inches.
 *
 * Notes:
 *   Illustrator = points internally (1 in = 72 pt)
 *   Regular hex (side = s):
 *     flat-to-flat = √3 * s  =>  s = flat / √3
 *   Flat-topped layout:
 *     center step horizontally (dx) = 1.5 * s
 *     center step vertically   (dy) = √3 * s  (= flat)
 */

(function () {
  if (app.documents.length === 0) {
    app.documents.add(DocumentColorSpace.RGB);
  }
  var doc = app.activeDocument;
  var IN2PT = 72.0;

  // --- Helpers (no .trim in ExtendScript) ---
  function parseNumberFromPrompt(msg, defVal) {
    var r = prompt(msg, defVal);
    if (r === null) throw new Error("User cancelled.");
    // remove leading/trailing whitespace manually
    r = String(r).replace(/^\s+|\s+$/g, "");
    var n = Number(r);
    if (isNaN(n)) throw new Error("Invalid number for: " + msg);
    return n;
  }

  function makeHexPath(container, cx, cy, s) {
    // Flat-topped hex centered at (cx, cy), side length s (points)
    var hr = s;                           // horizontal radius to corner
    var vr = Math.sqrt(3) * s / 2;        // vertical radius to flat
    var pts = [
      [cx - hr,     cy],          // left corner
      [cx - hr/2.0, cy - vr],     // upper-left
      [cx + hr/2.0, cy - vr],     // upper-right
      [cx + hr,     cy],          // right corner
      [cx + hr/2.0, cy + vr],     // lower-right
      [cx - hr/2.0, cy + vr]      // lower-left
    ];
    var p = container.pathItems.add();
    p.setEntirePath(pts);
    p.closed = true;
    p.filled = false;
    p.stroked = true;
    p.strokeWidth = 0.5;
    return p;
  }

  try {
    // --- Prompts ---
    var hexFlatIn   = parseNumberFromPrompt("Hex size (flat-to-flat), inches (e.g., 0.5):", 0.5);
    var squareSizeIn= parseNumberFromPrompt("Target honeycomb *square* size, inches (e.g., 10):", 10);

    // --- Convert & geometry ---
    var hexFlatPt   = hexFlatIn * IN2PT;
    var squareSizePt= squareSizeIn * IN2PT;

    // side length
    var s  = hexFlatPt / Math.sqrt(3);
    var dx = 1.5 * s;            // horiz center step
    var dy = Math.sqrt(3) * s;   // vert  center step (= hexFlatPt)

    // --- Hex counts: round UP based on your square/hex ratio ---
    // (your mental model: # across = ceil(square / hexFlat))
    var nCols = Math.max(1, Math.ceil(squareSizeIn / hexFlatIn));
    var nRows = Math.max(1, Math.ceil(squareSizeIn / hexFlatIn));

    // --- Actual coverage (in points) for this many hexes ---
    // width  = 2*s + (nCols-1)*dx
    // height = nRows * dy
    var actualWPt = 2*s + (nCols - 1) * dx;
    var actualHPt = nRows * dy;

    // --- Build layer/group ---
    var layer = doc.layers.add();
    layer.name = "Honeycomb_hex" + hexFlatIn + "in_square" + squareSizeIn + "in";
    var grp = layer.groupItems.add();
    grp.name = "Honeycomb Grid";

    // Layout origin (top-left). Illustrator Y grows downward.
    var startX = 0;
    var startY = 0;

    // Draw
    for (var col = 0; col < nCols; col++) {
      var cx = startX + s + col * dx;  // left margin = s
      var yOffset = (col % 2 === 0) ? 0 : (dy / 2); // odd columns shifted down half-step
      for (var row = 0; row < nRows; row++) {
        var cy = startY + (hexFlatPt/2) + yOffset + row * dy; // top margin = hexFlat/2
        makeHexPath(grp, cx, cy, s);
      }
    }

    // Optional: rectangle showing coverage
    var rect = grp.pathItems.rectangle(
      startY + actualHPt, // top
      startX,             // left
      actualWPt,          // width
      actualHPt           // height
    );
    rect.stroked = true; rect.filled = false; rect.strokeWidth = 0.5;
    rect.strokeDashes = [4,4];
    var c = new RGBColor(); c.red = 180; c.green = 180; c.blue = 180; rect.strokeColor = c;

    // Report
    var actualWIn = (actualWPt / IN2PT);
    var actualHIn = (actualHPt / IN2PT);

    alert(
      "Honeycomb created.\n" +
      "Hex flat-to-flat: " + hexFlatIn + " in\n" +
      "Square size requested: " + squareSizeIn + " in\n" +
      "Hex counts (rounded up): " + nCols + " × " + nRows + "\n" +
      "Actual coverage: " + actualWIn.toFixed(3) + " × " + actualHIn.toFixed(3) + " in"
    );

  } catch (e) {
    if (String(e.message) !== "User cancelled.") {
      alert("Error: " + e.message);
    }
  }
})();
