import test from "node:test";
import assert from "node:assert/strict";
import { GOVERNMENT_WARNING, verifyGovernmentWarning } from "../verification/label-verifier";
import { findUncertainRegions, findWarningPanel, scanLabelOrientations, type OcrPage, type Rotation } from "./scan-label";

// Controlled recognizer responses exercise scan order and crop/rotation decisions
// without downloading an OCR model or relying on engine accuracy.
function page(text: string, confidence = 95): OcrPage {
  return {
    text,
    confidence,
    width: 1600,
    height: 1200,
    lines: text.split("\n").map((text, index) => ({
      text, confidence,
      bbox: { x0: 100, y0: 100 + index * 30, x1: 1000, y1: 120 + index * 30 },
    })),
  };
}

test("a readable upright warning needs only one full-image scan", async () => {
  const called: Rotation[] = [];
  const progress: Rotation[] = [];
  const scan = await scanLabelOrientations(async (rotation) => {
    called.push(rotation);
    return page(GOVERNMENT_WARNING);
  }, (pass) => progress.push(pass.rotation));
  assert.deepEqual(called, [0]);
  assert.deepEqual(progress, called);
  assert.deepEqual(scan.rotations, called);
  assert.equal(scan.warning?.rotation, 0);
  assert.equal(scan.usedFallback, false);
});

test("sideways warning is recovered without replacing the upright application fields", async () => {
  const scan = await scanLabelOrientations(async (rotation) => page(rotation === 90 ? GOVERNMENT_WARNING.toUpperCase() : "CITRUS STOMP\n8.6%\n250ML"));
  assert.deepEqual(scan.rotations, [0, 90]);
  assert.equal(scan.text, "CITRUS STOMP\n8.6%\n250ML");
  assert.equal(scan.warning?.text, GOVERNMENT_WARNING.toUpperCase());
});

test("upside-down and counterclockwise warnings are attempted", async () => {
  for (const expected of [270, 180] as const) {
    const scan = await scanLabelOrientations(async (rotation) => page(rotation === expected ? GOVERNMENT_WARNING : "Other label text"));
    assert.equal(scan.warning?.rotation, expected);
    assert.equal(scan.rotations.at(-1), expected);
  }
});

test("unreadable warning is not reported as proven absent", async () => {
  const angles: Rotation[] = [];
  const scan = await scanLabelOrientations(async (rotation) => { angles.push(rotation); return page("No readable heading"); });
  assert.deepEqual(angles, [0, 90, 180, 270]);
  assert.equal(scan.warning, null);
  assert.equal(verifyGovernmentWarning(scan.text).status, "needs-review");
});

test("rotation never fixes an invalid heading by changing its capitalization", async () => {
  const text = GOVERNMENT_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:");
  const scan = await scanLabelOrientations(async () => page(text));
  assert.deepEqual(scan.rotations, [0]);
  assert.equal(verifyGovernmentWarning(scan.warning!.text).status, "mismatch");
});

test("warning lines are grouped by position so another column cannot interrupt them", () => {
  const words = GOVERNMENT_WARNING.toUpperCase();
  const split = words.indexOf("(2)");
  const paragraph = page(`${words.slice(0, split)}\n${words.slice(split)}`);
  paragraph.lines.splice(1, 0, {
    text: "ll", confidence: 12,
    bbox: { x0: 10, x1: 40, y0: 120, y1: 160 },
  });
  const warning = findWarningPanel(paragraph, 90)!;
  assert.equal(warning.text, words);
  assert.equal(warning.confidence, 95);
});

test("extra text inside the warning panel is preserved and does not pass wording checks", () => {
  const source = page(GOVERNMENT_WARNING.replace("women should", "women banana should"));
  const warning = findWarningPanel(source, 90)!;
  assert.match(warning.text, /banana/);
  assert.equal(verifyGovernmentWarning(warning.text).status, "mismatch");
});

test("multiple warning blocks remain ambiguous rather than selecting a favorable one", async () => {
  const text = `${GOVERNMENT_WARNING}\n${GOVERNMENT_WARNING}`;
  const scan = await scanLabelOrientations(async () => page(text));
  assert.equal(verifyGovernmentWarning(scan.warning!.text).status, "needs-review");
  assert.match(verifyGovernmentWarning(scan.warning!.text).notes[0], /Multiple/);
});

test("an uncertain warning can be replaced by a confident rotated reading", async () => {
  const scan = await scanLabelOrientations(async (rotation) => page(GOVERNMENT_WARNING, rotation === 0 ? 40 : 96));
  assert.deepEqual(scan.rotations, [0, 90]);
  assert.equal(scan.warning?.confidence, 96);
});

test("an already readable warning is not rescanned to find a more favorable result", async () => {
  const scan = await scanLabelOrientations(async (rotation) => page(GOVERNMENT_WARNING, rotation === 270 ? 99 : 85));
  assert.equal(scan.warning?.rotation, 0);
  assert.equal(scan.warning?.confidence, 85);
  assert.deepEqual(scan.rotations, [0]);
});

function uncertainPage(): OcrPage {
  const source = page("CITRUS STOMP\n8.6%\n250ML", 55);
  source.lines = Array.from({ length: 8 }, (_, index) => ({
    text: "xx", confidence: 25,
    bbox: { x0: 50, y0: 100 + index * 25, x1: 75, y1: 112 + index * 25 },
  }));
  return source;
}

test("dense uncertain fragments form a small region using their positions", () => {
  const regions = findUncertainRegions(uncertainPage());
  assert.equal(regions.length, 1);
  const region = regions[0];
  assert.ok(region.left < 50 && region.top < 100);
  assert.ok(region.left + region.width > 75);
  assert.ok(region.top + region.height > 287);
  assert.ok(region.width * region.height < 1600 * 1200 * 0.1);
});

test("confident text and isolated fragments do not trigger region scans", () => {
  assert.deepEqual(findUncertainRegions(page("A clear brand name")), []);
  const isolated = uncertainPage();
  isolated.lines = isolated.lines.slice(0, 1);
  assert.deepEqual(findUncertainRegions(isolated), []);
});

test("wide illustrations are not treated as narrow text regions", () => {
  const source = uncertainPage();
  source.lines = source.lines.map((line) => ({ ...line, bbox: { ...line.bbox, x1: 1200 } }));
  assert.deepEqual(findUncertainRegions(source), []);
});

test("region padding stays within the source image", () => {
  const source = uncertainPage();
  source.lines = source.lines.map((line) => ({ ...line, bbox: {
    x0: 1, x1: 20, y0: line.bbox.y0 - 99, y1: line.bbox.y1 - 99,
  } }));
  const region = findUncertainRegions(source)[0];
  assert.equal(region.left, 0);
  assert.equal(region.top, 0);
  assert.ok(region.left + region.width <= source.width);
  assert.ok(region.top + region.height <= source.height);
});

test("sideways warning is read from a crop without repeating the full-image scan", async () => {
  const source = uncertainPage();
  const scan = await scanLabelOrientations(async (rotation, region) => {
    if (region && rotation === 90) return page(GOVERNMENT_WARNING.toUpperCase());
    assert.equal(rotation, 0, "Unexpected full-image rotation");
    return source;
  });
  assert.equal(scan.passes.length, 2);
  assert.equal(scan.passes.filter((pass) => !pass.region).length, 1);
  assert.equal(scan.usedFallback, false);
  assert.deepEqual(scan.warning?.region, scan.passes[1].region);
  assert.equal(scan.text, source.text);
  assert.equal(scan.confidence, source.confidence);
});

test("the opposite reading direction is tried on the same crop", async () => {
  const scan = await scanLabelOrientations(async (rotation, region) => (
    region && rotation === 270 ? page(GOVERNMENT_WARNING) : uncertainPage()
  ));
  assert.equal(scan.passes.length, 3);
  assert.deepEqual(scan.passes[1].region, scan.passes[2].region);
  assert.equal(scan.warning?.rotation, 270);
  assert.equal(scan.usedFallback, false);
});

test("full-image fallback remains available when candidate crops miss the warning", async () => {
  const scan = await scanLabelOrientations(async (rotation, region) => (
    !region && rotation === 90 ? page(GOVERNMENT_WARNING) : uncertainPage()
  ));
  assert.equal(scan.passes.length, 4);
  assert.equal(scan.usedFallback, true);
  assert.deepEqual(scan.passes.at(-1), { rotation: 90 });
  assert.equal(scan.warning?.region, undefined);
});

test("a readable changed warning remains a mismatch without rescanning until it agrees", async () => {
  const changed = GOVERNMENT_WARNING.replace("women should", "women may");
  const scan = await scanLabelOrientations(async () => page(changed));
  assert.equal(scan.passes.length, 1);
  assert.equal(verifyGovernmentWarning(scan.warning!.text).status, "mismatch");
});

test("apparent wording differences in a crop are checked in full-image context", async () => {
  const clipped = GOVERNMENT_WARNING.replace("because of the risk of birth defects.", "");
  const scan = await scanLabelOrientations(async (rotation, region) => {
    if (region && rotation === 90) return page(clipped);
    if (!region && rotation === 90) return page(GOVERNMENT_WARNING);
    return uncertainPage();
  });
  assert.equal(scan.usedFallback, true);
  assert.equal(scan.warning?.region, undefined);
  assert.equal(scan.warning?.text, GOVERNMENT_WARNING);
});

test("other candidate panels are read after finding the warning and retained as field evidence", async () => {
  const source = uncertainPage();
  source.lines.push(...source.lines.map((item) => ({ ...item, bbox: { ...item.bbox, x0: 950, x1: 975 } })));
  const scan = await scanLabelOrientations(async (_rotation, region) => {
    if (!region) return source;
    return page(region.left < 500 ? GOVERNMENT_WARNING : "LEMON WINE WITH NATURAL FLAVORS");
  });
  assert.equal(scan.passes.length, 3);
  assert.equal(scan.pages.length, 3);
  assert.ok(scan.pages.some((item) => item.text.includes("LEMON WINE")));
  assert.equal(scan.usedFallback, false);
});

test("a crop touching text is expanded before keeping its field evidence", async () => {
  const source = uncertainPage();
  const initialRegion = findUncertainRegions(source)[0];
  const scan = await scanLabelOrientations(async (_rotation, region) => {
    if (!region) return source;
    const output = page(GOVERNMENT_WARNING);
    if (region.height === initialRegion.height) output.lines[0].bbox.x0 = 0;
    return output;
  });
  assert.equal(scan.passes.length, 3);
  assert.ok(scan.passes[2].region!.height > initialRegion.height);
  assert.equal(scan.pages.at(-1)!.region!.height, scan.passes[2].region!.height);
});
