import { extractWarningBlock, warningWordingMatches } from "./label-verifier";
import { originalImageBox, unionBoxes, type BoundingBox, type ImageSource } from "./label-evidence";

export const LABEL_ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof LABEL_ROTATIONS)[number];
export type OcrLine = {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};
export type ScanRegion = { left: number; top: number; width: number; height: number };
export type ScanPass = { rotation: Rotation; region?: ScanRegion };
export type OcrPage = { text: string; confidence: number; lines: OcrLine[]; width: number; height: number };
export type EvidencePage = OcrPage & ScanPass & { image?: ImageSource };
export type WarningScan = { text: string; confidence: number; rotation: Rotation; region?: ScanRegion; manuallyEdited?: boolean; bbox?: BoundingBox };
export type LabelScan = {
  text: string;
  confidence: number;
  warning: WarningScan | null;
  rotations: Rotation[];
  passes: ScanPass[];
  usedFallback: boolean;
  pages: EvidencePage[];
};

function cropTouchesText(page: OcrPage): boolean {
  return page.lines.some((line) => line.confidence >= 70 && line.text.trim().length >= 6
    && (line.bbox.x0 <= 2 || line.bbox.y0 <= 2 || line.bbox.x1 >= page.width - 2 || line.bbox.y1 >= page.height - 2));
}

function expandRegion(region: ScanRegion, page: OcrPage): ScanRegion {
  const padding = Math.ceil(region.height * 0.3);
  const top = Math.max(0, region.top - padding);
  const bottom = Math.min(page.height, region.top + region.height + padding);
  return { ...region, top, height: bottom - top };
}

export function findUncertainRegions(page: OcrPage): ScanRegion[] {
  // Sideways text often becomes many short, low-confidence fragments. Group
  // nearby fragments using their positions, without assuming a fixed panel edge.
  const fragments = page.lines.filter((line) => (
    line.confidence < 85 &&
    line.bbox.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0 &&
    line.bbox.x1 - line.bbox.x0 < page.width * 0.15 &&
    line.bbox.y1 - line.bbox.y0 < page.height * 0.10
  )).slice(0, 600);
  if (!fragments.length) return [];
  const heights = fragments.map((line) => line.bbox.y1 - line.bbox.y0).sort((a, b) => a - b);
  const gap = Math.max(6, heights[Math.floor(heights.length / 2)] * 3);
  const remaining = new Set(fragments);
  const groups: OcrLine[][] = [];
  for (const seed of fragments) {
    if (!remaining.delete(seed)) continue;
    const group = [seed];
    for (let index = 0; index < group.length; index++) {
      for (const other of remaining) {
        const a = group[index].bbox;
        const b = other.bbox;
        const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
        const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
        if (dx <= gap && dy <= gap) {
          remaining.delete(other);
          group.push(other);
        }
      }
    }
    if (group.length >= 6) groups.push(group);
  }
  return groups.map((group) => {
    const left = Math.max(0, Math.floor(Math.min(...group.map((line) => line.bbox.x0)) - gap));
    const top = Math.max(0, Math.floor(Math.min(...group.map((line) => line.bbox.y0)) - gap));
    const right = Math.min(page.width, Math.ceil(Math.max(...group.map((line) => line.bbox.x1)) + gap));
    const bottom = Math.min(page.height, Math.ceil(Math.max(...group.map((line) => line.bbox.y1)) + gap));
    return { left, top, width: right - left, height: bottom - top, fragments: group.length };
  })
    .filter((region) => region.height > region.width * 1.5 && region.width * region.height < page.width * page.height * 0.3)
    .sort((a, b) => b.fragments - a.fragments)
    .slice(0, 3)
    .map(({ left, top, width, height }) => ({ left, top, width, height }));
}

export function findWarningPanel(page: OcrPage, rotation: Rotation): WarningScan | null {
  const headings = page.lines.filter((line) => /government\s+warning\s*:/i.test(line.text));
  // Do not choose one favorable block when multiple warnings were detected.
  if (headings.length > 1) return { text: page.text, confidence: page.confidence, rotation };
  const heading = headings[0];
  if (!heading) {
    const text = extractWarningBlock(page.text);
    return text ? { text: page.text, confidence: page.confidence, rotation } : null;
  }

  const lineHeight = Math.max(1, heading.bbox.y1 - heading.bbox.y0);
  const nearby = page.lines
    .filter((line) => line === heading || (
      line.bbox.y0 >= heading.bbox.y1 &&
      Math.abs(line.bbox.x0 - heading.bbox.x0) <= lineHeight * 2 &&
      line.bbox.y0 - heading.bbox.y0 < lineHeight * 24
    ))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const paragraph: OcrLine[] = [];
  for (const line of nearby) {
    const previous = paragraph.at(-1);
    if (previous && line.bbox.y0 - previous.bbox.y1 > lineHeight * 3) break;
    paragraph.push(line);
    if (/health\s+problems\./i.test(line.text)) break;
  }
  // Group lines by position; never remove, complete, or correct words inside
  // a warning to make it match. Preserve OCR mistakes for human review.
  const text = extractWarningBlock(paragraph.map((line) => line.text.trim()).join(" "));
  const characters = paragraph.reduce((sum, line) => sum + line.text.trim().length, 0);
  const confidence = paragraph.reduce((sum, line) => sum + line.confidence * line.text.trim().length, 0) / Math.max(1, characters);
  const bounds = unionBoxes(paragraph.map((line) => line.bbox));
  return { text, confidence, rotation, bbox: bounds };
}

function warningScore(warning: WarningScan): number {
  // Prefer complete readable wording. Heading case is evaluated separately by
  // the verifier so rotating must never hide an invalid title-case heading.
  return (warningWordingMatches(extractWarningBlock(warning.text)) ? 1000 : 0)
    + (/health\s+problems\./i.test(warning.text) ? 100 : 0)
    + warning.confidence;
}

export async function scanLabelOrientations(
  recognize: (rotation: Rotation, region?: ScanRegion) => Promise<OcrPage>,
  onPass?: (pass: ScanPass) => void,
): Promise<LabelScan> {
  const passes: ScanPass[] = [];
  const pages: EvidencePage[] = [];
  let warning: WarningScan | null = null;
  const read = async (rotation: Rotation, region?: ScanRegion) => {
    const pass = region ? { rotation, region } : { rotation };
    onPass?.(pass);
    const page = await recognize(rotation, region);
    passes.push(pass);
    const candidate = findWarningPanel(page, rotation);
    if (candidate && (!warning || warningScore(candidate) > warningScore(warning))) {
      warning = { ...candidate, ...(region ? { region } : {}),
        bbox: candidate.bbox ? originalImageBox(candidate.bbox, { ...page, rotation, region }) : undefined };
    }
    return page;
  };
  const readable = () => warning !== null && warning.confidence >= 70
    && /health\s+problems\./i.test(warning.text)
    // A crop may cut off words. Confirm an apparent wording difference in
    // full-image context before treating it as a mismatch.
    && (!warning.region || warningWordingMatches(extractWarningBlock(warning.text)));
  const primary = await read(0);
  pages.push({ ...primary, rotation: 0 });
  const result = (usedFallback: boolean): LabelScan => ({
    text: primary.text, confidence: primary.confidence, warning,
    rotations: [...new Set(passes.map((pass) => pass.rotation))], passes, usedFallback, pages,
  });
  // A readable altered warning remains a mismatch. Do not retry until an OCR
  // reading happens to agree with the required wording.
  const regions = findUncertainRegions(primary);
  if (readable() && !regions.length) return result(false);

  for (const region of regions) {
    // Geometry identifies vertical text, but not its reading direction. Try
    // the two quarter-turn directions on this small crop only.
    let best: EvidencePage | null = null;
    for (const rotation of [90, 270] as const) {
      let sourceRegion = region;
      let page = await read(rotation, sourceRegion);
      if (cropTouchesText(page)) {
        const expanded = expandRegion(region, primary);
        if (expanded.height > region.height && expanded.width * expanded.height < primary.width * primary.height * 0.4) {
          sourceRegion = expanded;
          page = await read(rotation, sourceRegion);
        }
      }
      if (!best || page.confidence > best.confidence) best = { ...page, rotation, region: sourceRegion };
      if (page.confidence >= 70) break;
    }
    if (best && best.confidence >= 70) pages.push(best);
  }
  if (readable()) return result(false);
  // Retain broad coverage for text omitted by the layout analysis, upside-down
  // images, and layouts that do not form a compact candidate region.
  for (const rotation of LABEL_ROTATIONS.slice(1)) {
    const page = await read(rotation);
    if (page.confidence >= 70) pages.push({ ...page, rotation });
    if (readable()) return result(true);
  }
  return result(true);
}
