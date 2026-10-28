import type { OcrLine } from "./scan-label";

export type TextPanel = { lines: OcrLine[] };

export function groupTextPanels(lines: OcrLine[]): TextPanel[] {
  const valid = lines.filter((line) => line.text.trim() && line.bbox.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0);
  const remaining = new Set(valid);
  const panels: TextPanel[] = [];
  for (const seed of valid) {
    if (!remaining.delete(seed)) continue;
    const group = [seed];
    for (let index = 0; index < group.length; index++) {
      const a = group[index].bbox;
      const aHeight = a.y1 - a.y0;
      const aWidth = a.x1 - a.x0;
      for (const other of remaining) {
        const b = other.bbox;
        const bHeight = b.y1 - b.y0;
        const bWidth = b.x1 - b.x0;
        const scale = Math.min(aHeight, bHeight) / Math.max(aHeight, bHeight);
        const verticalGap = Math.max(0, b.y0 - a.y1, a.y0 - b.y1);
        const overlap = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
        const aligned = Math.abs(a.x0 - b.x0) <= Math.min(aHeight, bHeight)
          || Math.abs((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2) <= Math.min(aHeight, bHeight);
        if (scale >= 0.55 && aligned && overlap / Math.min(aWidth, bWidth) >= 0.6
          && verticalGap <= Math.max(aHeight, bHeight) * 1.25) {
          remaining.delete(other);
          group.push(other);
        }
      }
    }
    panels.push({ lines: group.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0) });
  }
  return panels;
}
