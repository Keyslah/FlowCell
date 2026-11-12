import assert from "node:assert/strict";

/** A source-only preset cannot promise to restore files that exist only on its donor. */
export function assertSelfContainedProgramAppearance(appearance) {
  function inspect(source, location, depth = 0) {
    assert.ok(depth <= 8, `${location}: nested image assets exceed 8 levels.`);
    assert.ok(!/theme-asset:|@import\b|(?:-webkit-)?image-set\s*\(/i.test(source),
      `${location}: unresolved image/font assets must be embedded before packaging.`);
    function reference(raw) {
      const value = raw.trim().replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
      assert.ok(value.startsWith("#") || /^data:/i.test(value),
        `${location}: external or local asset '${value.slice(0, 160)}' must be embedded before packaging.`);
      if (/^data:image\/svg\+xml[;,]/i.test(value)) {
        const comma = value.indexOf(",");
        assert.ok(comma !== -1, `${location}: malformed embedded SVG.`);
        const content = /;base64$/i.test(value.slice(0, comma))
          ? Buffer.from(value.slice(comma + 1), "base64").toString("utf8") : decodeURIComponent(value.slice(comma + 1));
        inspect(content, `${location}/embedded-svg`, depth + 1);
      }
    }
    // Quoted CSS URLs may contain parentheses inside embedded SVG data.
    const urls = /\burl\s*\(/ig;
    let match;
    while ((match = urls.exec(source))) {
      let cursor = urls.lastIndex;
      while (/\s/.test(source[cursor] ?? "") && cursor < source.length) cursor++;
      const quote = source[cursor] === '"' || source[cursor] === "'" ? source[cursor++] : null;
      let value = "";
      let closed = false;
      while (cursor < source.length) {
        const character = source[cursor++];
        if (character === "\\") { value += character + (source[cursor++] ?? ""); continue; }
        if (character === (quote ?? ")")) { closed = true; break; }
        value += character;
      }
      if (quote) {
        while (/\s/.test(source[cursor] ?? "") && cursor < source.length) cursor++;
        assert.equal(source[cursor++], ")", `${location}: malformed CSS asset reference.`);
      }
      assert.ok(closed, `${location}: unterminated CSS asset reference.`);
      reference(value);
      urls.lastIndex = cursor;
    }
    assert.ok(!/\bsrcset\s*=/i.test(source), `${location}: srcset assets must be embedded in a supported single-source skin.`);
    for (const match of source.matchAll(/\b(?:src|(?:xlink:)?href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/ig)) {
      reference(match[1] ?? match[2] ?? match[3]);
    }
  }
  const sources = { ...appearance.skinSources };
  if (appearance.kind === "FlowCellPortableTheme") {
    for (const [index, button] of (appearance.theme?.buttons ?? []).entries()) {
      for (const section of ["structure", "base", "hover", "pressed", "held", "release", "play", "disabled", "error", "keyframes"]) {
        sources[`${index}/${section}`] = button.skin?.[section];
      }
      for (const [count, source] of Object.entries(button.skin?.metadata?.buttonSkinEmbeddedVariants ?? {})) sources[`${index}/variant-${count}`] = source;
    }
  }
  for (const [name, source] of Object.entries(sources)) {
    assert.equal(typeof source, "string", `Skin source '${name}' must be text.`);
    inspect(source, `Skin source '${name}'`);
  }
}
