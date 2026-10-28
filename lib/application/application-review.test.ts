import test from "node:test";
import assert from "node:assert/strict";
import { reviewApplication, type ApplicationImage } from "./application-review";
import { processApplicationBatch } from "./application-processor";
import { GOVERNMENT_WARNING, type ApplicationFields } from "../verification/label-verifier";
import { findWarningPanel, type LabelScan, type OcrPage } from "../ocr/scan-label";
import { originalImageBox, type ImageLabel } from "../label-evidence";

// Synthetic OCR evidence keeps aggregation, failure handling, and application-ID
// rules deterministic; actual image recognition is checked by scripts/check-samples.ts.
const expected: ApplicationFields = {
  brandName: "OLD TOM DISTILLERY", classType: "Kentucky Straight Bourbon Whiskey", alcoholContent: "45%",
  netContents: "750 mL", producerName: "Old Tom Distillery, Louisville, KY", countryOfOrigin: "United States",
};
const frontText = ["Brand: OLD TOM DISTILLERY", "Class: Kentucky Straight Bourbon Whiskey", "45% ABV", "750 mL", "Bottled by Old Tom Distillery, Louisville, KY"];

function scan(text: string[]): LabelScan {
  const page: OcrPage = { text: text.join("\n"), confidence: 95, width: 1600, height: 1200,
    lines: text.map((text, index) => ({ text, confidence: 95, bbox: { x0: 100, y0: 80 + index * 90, x1: 1300, y1: 110 + index * 90 } })),
  };
  return { text: page.text, confidence: 95, pages: [{ ...page, rotation: 0 }], passes: [{ rotation: 0 }],
    warning: findWarningPanel(page, 0), rotations: [0], usedFallback: false };
}
function image(id: string, text: string[], label: ImageLabel = "", applicationId = "APP-1"): ApplicationImage {
  return { id, applicationId, name: `${id}.png`, label, status: "success", scan: scan(text) };
}

test("brand on front and warning on back are evaluated as one application", () => {
  const result = reviewApplication("APP-1", expected, [image("front", frontText, "Front"), image("back", [GOVERNMENT_WARNING], "Back")]);
  assert.equal(result.complete, true);
  assert.equal(result.results[0].status, "match");
  assert.equal(result.warningPresence, "found");
  const warning = result.results.at(-1)!;
  assert.match(warning.notes[0], /wording.*match/);
  assert.equal(warning.observations![0].image!.imageId, "back");
  assert.deepEqual(warning.observations![0].bbox, { x0: 100, y0: 80, x1: 1300, y1: 110 });
  assert.equal(result.results[0].observations![0].image!.applicationId, "APP-1");
});

test("a single wraparound image works without front or back images", () => {
  const result = reviewApplication("APP-1", expected, [image("wrap", [...frontText, GOVERNMENT_WARNING], "Wraparound")]);
  assert.equal(result.complete, true);
  assert.equal(result.processedImages, 1);
  assert.equal(result.warningPresence, "found");
  assert.ok(result.results.slice(0, -1).every((item) => item.status === "match"));
});

test("matching repeated values including equivalent numeric units produce one finding", () => {
  const result = reviewApplication("APP-1", expected, [image("a", [...frontText, GOVERNMENT_WARNING]),
    image("b", ["90 Proof", "0.75 L", GOVERNMENT_WARNING.toUpperCase()])]);
  const alcohol = result.results.filter((item) => item.field === "Alcohol Content");
  assert.equal(alcohol.length, 1);
  assert.equal(alcohol[0].status, "match");
  assert.equal(new Set(alcohol[0].observations!.map((entry) => entry.image!.imageId)).size, 2);
  assert.equal(result.results.find((item) => item.field === "Net Contents")!.status, "match");
  assert.ok(!result.results.at(-1)!.notes.some((note) => /conflicting|Multiple warning/.test(note)));
});

test("conflicting ABV across images needs review and retains both values and boxes", () => {
  const result = reviewApplication("APP-1", expected, [image("front", frontText.map((line) => line.replace("45%", "40%")), "Front"),
    image("back", ["45% ABV", GOVERNMENT_WARNING], "Back")]);
  const alcohol = result.results.find((item) => item.field === "Alcohol Content")!;
  assert.equal(alcohol.status, "needs-review");
  assert.deepEqual(new Set(alcohol.observations!.map((entry) => entry.value)), new Set(["40%", "45%"]));
  assert.ok(alcohol.observations!.every((entry) => entry.bbox && entry.image!.applicationId === "APP-1"));
  assert.match(alcohol.extracted!, /40%.*45%/);
});

test("not detected is reported only after every supplied image succeeds", () => {
  const images = [image("a", frontText.filter((line) => line !== "750 mL")), image("b", [GOVERNMENT_WARNING])];
  const volume = reviewApplication("APP-1", expected, images).results.find((item) => item.field === "Net Contents")!;
  assert.equal(volume.detection, "not-detected");
  assert.match(volume.notes[0], /Not detected in supplied images/);
  images.push({ id: "pending", applicationId: "APP-1", name: "pending.png", status: "pending" });
  const incomplete = reviewApplication("APP-1", expected, images).results.find((item) => item.field === "Net Contents")!;
  assert.equal(incomplete.detection, "unavailable");
  assert.ok(incomplete.notes.every((note) => !note.includes("Not detected")));
});

test("one failed image blocks overall pass and definitive missing-field conclusions", () => {
  const result = reviewApplication("APP-1", expected, [image("front", frontText),
    { id: "back", applicationId: "APP-1", name: "back.png", status: "error", error: "Image decode failed" }]);
  assert.equal(result.complete, false);
  assert.equal(result.status, "needs-review");
  assert.equal(result.warningPresence, "unavailable");
  assert.ok(result.results.every((item) => item.status === "needs-review"));
  assert.ok(result.results.every((item) => item.notes.some((note) => note.includes("back.png (failed)"))));
  assert.ok(result.results.every((item) => item.notes.every((note) => !note.includes("Not detected"))));
});

test("side labels are informational and never restrict where fields are found", () => {
  const result = reviewApplication("APP-1", expected, [image("brand", frontText, "Back"), image("warning", [GOVERNMENT_WARNING], "Front")]);
  assert.equal(result.results[0].status, "match");
  assert.equal(result.warningPresence, "found");
});

test("strict warning mismatch is preserved and a different warning on another image is not ignored", () => {
  const invalid = GOVERNMENT_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:");
  assert.equal(reviewApplication("APP-1", expected, [image("bad", [invalid])]).results.at(-1)!.status, "mismatch");
  const result = reviewApplication("APP-1", expected, [image("bad", [invalid]), image("good", [GOVERNMENT_WARNING])]);
  assert.equal(result.warningPresence, "found");
  assert.equal(result.results.at(-1)!.status, "needs-review");
  assert.equal(result.results.at(-1)!.observations!.length, 2);
});

test("manual correction does not hide a conflict between images", () => {
  const result = reviewApplication("APP-1", expected, [image("a", ["40% ABV"]), image("b", ["45% ABV", GOVERNMENT_WARNING])],
    { overrides: { alcoholContent: "45%" }, correctionSources: { alcoholContent: "b" } });
  const alcohol = result.results.find((item) => item.field === "Alcohol Content")!;
  assert.equal(alcohol.status, "needs-review");
  assert.match(alcohol.extracted!, /40%.*45%/);
});

test("foreign application IDs cannot contaminate an application's evidence", () => {
  assert.throws(() => reviewApplication("APP-1", expected, [image("foreign", ["40% ABV"], "", "APP-2")]), /explicitly belong/);
});

test("boxes from cropped quarter-turn OCR map back to the original image", () => {
  const box = { x0: 20, y0: 30, x1: 80, y1: 70 };
  assert.deepEqual(originalImageBox(box, { rotation: 90, width: 200, height: 300,
    region: { left: 100, top: 200, width: 300, height: 200 } }), { x0: 130, y0: 320, x1: 170, y1: 380 });
  assert.deepEqual(originalImageBox(box, { rotation: 180, width: 300, height: 200 }), { x0: 220, y0: 130, x1: 280, y1: 170 });
  assert.deepEqual(originalImageBox(box, { rotation: 270, width: 200, height: 300 }), { x0: 230, y0: 20, x1: 270, y1: 80 });
});

test("processing is bounded, image failures are isolated, and retry can complete review", async () => {
  let active = 0;
  let peak = 0;
  const tasks = ["front", "back", "extra"].map((id) => ({ id, applicationId: "APP-1", name: `${id}.png`, input: id }));
  const batch = await processApplicationBatch([{ applicationId: "APP-1", images: tasks }], async (task) => {
    peak = Math.max(peak, ++active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (task.id === "back") throw new Error("Cannot decode back.png");
      return scan(frontText);
    } finally { active--; }
  }, { concurrency: 20 });
  assert.equal(peak, 2);
  assert.equal(batch.applications[0].images.length, 3);
  assert.equal(batch.applications[0].images[1].error, "Cannot decode back.png");
  assert.ok(batch.applications[0].latencyMs > 0);
  const retry = await processApplicationBatch([{ applicationId: "APP-1", images: [tasks[1]] }], async () => scan([GOVERNMENT_WARNING]));
  const repaired = batch.applications[0].images.map((item) => item.id === "back" ? retry.applications[0].images[0] : item);
  assert.equal(reviewApplication("APP-1", expected, repaired).complete, true);
});

test("batch images remain explicitly associated with their own application IDs", async () => {
  const batch = await processApplicationBatch(["APP-1", "APP-2"].map((applicationId) => ({ applicationId,
    images: [{ id: "same-id", name: "same-name.png", applicationId, input: applicationId }],
  })), async (task) => scan([task.applicationId === "APP-1" ? "40% ABV" : "45% ABV"]));
  assert.equal(batch.applications.length, 2);
  for (const application of batch.applications) {
    assert.ok(application.images.every((image) => image.applicationId === application.applicationId));
    assert.match(application.images[0].scan!.text, application.applicationId === "APP-1" ? /40%/ : /45%/);
  }
  await assert.rejects(processApplicationBatch([{ applicationId: "APP-1", images: [
    { id: "wrong", name: "wrong.png", applicationId: "APP-2", input: "" },
  ] }], async () => scan([])), /explicitly belong/);
});

test("an image with no readable text remains unavailable rather than proving fields missing", async () => {
  const processed = await processApplicationBatch([{ applicationId: "APP-1", images: [
    { id: "empty", applicationId: "APP-1", name: "empty.png", input: "" },
  ] }], async () => scan([]));
  assert.equal(processed.applications[0].images[0].status, "error");
  assert.match(processed.applications[0].images[0].error!, /No readable text/);
  const result = reviewApplication("APP-1", expected, processed.applications[0].images);
  assert.equal(result.complete, false);
  assert.ok(result.results.every((item) => item.detection === "unavailable"));
});

test("unrelated text following identical warning blocks does not create a conflict", () => {
  const a = image("a", [GOVERNMENT_WARNING]);
  const b = image("b", [GOVERNMENT_WARNING]);
  b.scan!.warning!.text += " CONTAINS SULFITES.";
  const result = reviewApplication("APP-1", expected, [a, b]);
  assert.match(result.results.at(-1)!.notes[0], /wording.*match/);
  assert.ok(!result.results.at(-1)!.notes.some((note) => note.includes("conflicting")));
});
