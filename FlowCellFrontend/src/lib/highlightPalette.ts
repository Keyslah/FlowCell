const GREEN_HIGHLIGHT_PALETTE = [
  "#d7ff4b",
  "#b9ff5d",
  "#97ff63",
  "#73ff70",
  "#54f67d",
  "#68ff9c",
  "#85ff52",
  "#c3ff63"
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function resolveGreenHighlightColor(key: string): string {
  const normalizedKey = key.trim().toLowerCase();
  if (!normalizedKey) {
    return GREEN_HIGHLIGHT_PALETTE[0];
  }

  return GREEN_HIGHLIGHT_PALETTE[hashString(normalizedKey) % GREEN_HIGHLIGHT_PALETTE.length];
}
