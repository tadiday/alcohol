import test from "node:test";
import assert from "node:assert/strict";
import { extractSpatialFields } from "./field-extractor";
import { GOVERNMENT_WARNING, verifyLabel, type ApplicationFields } from "./label-verifier";
import type { EvidencePage, OcrLine } from "../ocr/scan-label";

function line(text: string, x: number, y: number, width: number, height = 24, confidence = 95): OcrLine {
  return { text, confidence, bbox: { x0: x, y0: y, x1: x + width, y1: y + height } };
}
function page(lines: OcrLine[], confidence = 40): EvidencePage {
  return { text: lines.map((item) => item.text).join("\n"), lines, confidence, width: 1600, height: 1200, rotation: 0 };
}
const application: ApplicationFields = {
  brandName: "OLD TOM DISTILLERY", classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45%", netContents: "750 mL", producerName: "Old Tom Distillery, Louisville, KY", countryOfOrigin: "United States",
};

test("prominent multiline brand is grouped without text from another column", () => {
  const source = page([
    line("OLD TOM", 100, 100, 500, 70),
    line("1 shot vodka", 950, 130, 240),
    line("DISTILLERY", 100, 190, 500, 70),
    line("Kentucky Straight Bourbon Whiskey", 100, 400, 600, 40),
  ]);
  const fields = extractSpatialFields([source]);
  assert.equal(fields.brandName.value, "OLD TOM DISTILLERY");
  assert.equal(fields.brandName.uncertain, false);
  assert.equal(fields.classType.value, application.classType);
});

test("low-confidence text inside a brand is retained and causes review", () => {
  const fields = extractSpatialFields([page([
    line("OLD", 100, 100, 400, 50), line("EXTRA", 100, 165, 400, 50, 30), line("TOM", 100, 230, 400, 50),
  ])]);
  assert.equal(fields.brandName.value, "OLD EXTRA TOM");
  assert.equal(fields.brandName.confidence, 30);
  assert.equal(fields.brandName.uncertain, true);
});

test("brand artifacts are preserved and flagged rather than silently removed", () => {
  const fields = extractSpatialFields([page([line("CITRUS _", 100, 100, 700, 90, 84), line("STOMP", 100, 210, 700, 90, 94)])]);
  assert.equal(fields.brandName.value, "CITRUS _ STOMP");
  assert.equal(fields.brandName.uncertain, true);
  assert.match(fields.brandName.notes![0], /artifact/);
});

test("producer name and address stay together despite interleaved columns", () => {
  const fields = extractSpatialFields([page([
    line("Produced & Canned by", 800, 100, 320), line("8.6%", 1300, 105, 100),
    line("EVERGOOD ELIXIRS", 800, 135, 320, 24, 89), line("250ML", 1300, 140, 100),
    line("Palmer Lake, CO", 800, 170, 320), line("More drink recipes at", 800, 205, 320),
  ])]);
  assert.equal(fields.producerName.value, "EVERGOOD ELIXIRS, Palmer Lake, CO");
  assert.equal(fields.producerName.confidence, 89);
  assert.ok(!fields.producerName.evidence!.includes("recipes"));
});

test("an address in another column is not appended to the producer", () => {
  const fields = extractSpatialFields([page([
    line("Produced by", 100, 100, 320), line("Example Distillery", 100, 135, 320),
    line("Another City, NY", 900, 170, 320),
  ])]);
  assert.equal(fields.producerName.value, "Example Distillery");
});

test("serving volume and recipe alcohol are excluded from container fields", () => {
  const fields = extractSpatialFields([page([
    line("Serving size: 148 mL", 100, 100, 500), line("1 shot vodka", 100, 140, 500),
    line("250ML", 1000, 100, 120), line("8.6%", 1000, 200, 120), line("ALC/VOL", 1000, 235, 120),
  ])]);
  assert.equal(fields.netContents.value, "250ML");
  assert.equal(fields.netContents.uncertain, false);
  assert.equal(fields.alcoholContent.value, "8.6%");
  assert.equal(fields.classType.value, "");
});

test("agreeing ABV and proof candidates do not create a false ambiguity", () => {
  const fields = extractSpatialFields([page([line("45% ABV", 100, 100, 300), line("90 Proof", 900, 400, 300)])]);
  assert.equal(fields.alcoholContent.uncertain, false);
});

test("conflicting confident numeric values need review regardless of the application", () => {
  const source = page([line("45% ABV", 100, 100, 300), line("40% ABV", 900, 400, 300)]);
  const fields = extractSpatialFields([source]);
  assert.equal(fields.alcoholContent.uncertain, true);
  const result = verifyLabel(application, source.text, { fields }).find((item) => item.field === "Alcohol Content")!;
  assert.equal(result.status, "needs-review");
  assert.match(result.evidence!, /45% ABV/);
  assert.match(result.evidence!, /40% ABV/);
});

test("matching fields use their own confidence despite a poor overall scan", () => {
  const source = page([line("45% ABV", 100, 100, 300, 24, 96), line("750 mL", 900, 400, 300, 24, 92)], 25);
  const fields = extractSpatialFields([source]);
  const results = verifyLabel(application, source.text, { fields, confidence: source.confidence });
  const alcohol = results.find((item) => item.field === "Alcohol Content")!;
  const volume = results.find((item) => item.field === "Net Contents")!;
  assert.equal(alcohol.status, "match");
  assert.equal(alcohol.confidence, 96);
  assert.equal(volume.status, "match");
  assert.equal(volume.confidence, 92);
});

test("a confident field mismatch stays a mismatch even when overall confidence is low", () => {
  const source = page([line("5% ABV", 100, 100, 300, 24, 96)], 25);
  const result = verifyLabel(application, source.text, { fields: extractSpatialFields([source]), confidence: 25 })
    .find((item) => item.field === "Alcohol Content")!;
  assert.equal(result.status, "mismatch");
  assert.equal(result.extracted, "5%");
});

test("low confidence is applied only to the affected field", () => {
  const source = page([line("45% ABV", 100, 100, 300, 24, 40), line("750 mL", 900, 400, 300, 24, 92)], 95);
  const results = verifyLabel(application, source.text, { fields: extractSpatialFields([source]), confidence: 95 });
  assert.equal(results.find((item) => item.field === "Alcohol Content")!.status, "needs-review");
  assert.equal(results.find((item) => item.field === "Net Contents")!.status, "match");
});

test("manual corrections do not claim an automated confidence score", () => {
  const source = page([line("5% ABV", 100, 100, 300)]);
  const result = verifyLabel(application, source.text, {
    fields: extractSpatialFields([source]), overrides: { alcoholContent: "45%" },
  }).find((item) => item.field === "Alcohol Content")!;
  assert.equal(result.status, "match");
  assert.equal(result.confidence, null);
  assert.equal(result.source, "Manual correction");
});

test("clipped rotated class text needs review even with high recognition confidence", () => {
  const source = page([line("Lemon Wine", 0, 100, 250, 24, 96)]);
  source.region = { left: 20, top: 50, width: 300, height: 500 };
  source.rotation = 90;
  const fields = extractSpatialFields([source]);
  assert.equal(fields.classType.uncertain, true);
  assert.match(fields.classType.notes![0], /crop edge/);
});

test("field evidence from a rotated region retains its source", () => {
  const source = page([line("Lemon Wine", 50, 100, 250, 24, 96)]);
  source.region = { left: 20, top: 50, width: 300, height: 500 };
  source.rotation = 90;
  const fields = extractSpatialFields([source]);
  assert.equal(fields.classType.value, "Lemon Wine");
  assert.equal(fields.classType.source, "Text region read at 90°");
  assert.equal(fields.classType.confidence, 96);
});

test("empty scans keep all fields uncertain", () => {
  assert.ok(Object.values(extractSpatialFields([])).every((field) => field.uncertain && !field.value));
});

test("warning text cannot supply application field candidates", () => {
  const fields = extractSpatialFields([page([line(GOVERNMENT_WARNING, 100, 100, 1200, 24)])]);
  assert.ok(Object.values(fields).every((field) => !field.value));
});

test("an explicit brand is extracted independently of expected application values", () => {
  const source = page([line("Brand: Another Distillery", 100, 100, 800, 50)]);
  const fields = extractSpatialFields([source]);
  assert.equal(fields.brandName.value, "Another Distillery");
  assert.equal(verifyLabel(application, source.text, { fields })[0].status, "mismatch");
});

test("manual warning corrections are identified without an automatic confidence score", () => {
  const warning = verifyLabel(application, "", { warning: { text: GOVERNMENT_WARNING, confidence: 25, manuallyEdited: true } }).at(-1)!;
  assert.equal(warning.confidence, null);
  assert.equal(warning.source, "Manual correction");
  assert.match(warning.notes.join(" "), /manually corrected/);
});

test("a contradictory bare percentage cannot be hidden by an explicit ABV candidate", () => {
  const fields = extractSpatialFields([page([line("45% ABV", 100, 100, 300), line("40%", 900, 400, 300)])]);
  assert.equal(fields.alcoholContent.uncertain, true);
});

test("a cocktail marketing graphic is not confidently classified as a brand", () => {
  const fields = extractSpatialFields([page([
    line("PERFECT FOR", 100, 100, 600, 60), line("SIPPING NEAT", 100, 180, 600, 60), line("CLASSIC COCKTAIL", 100, 260, 600, 60),
  ])]);
  assert.equal(fields.brandName.uncertain, true);
});

test("marketing copy containing a beverage word needs class/type review", () => {
  const fields = extractSpatialFields([page([line("AMERICA'S FIRST BOTTLED BOURBON", 100, 100, 1000, 60)])]);
  assert.equal(fields.classType.uncertain, true);
});

test("marketing context on an adjacent line prevents a confident class/type guess", () => {
  const fields = extractSpatialFields([page([
    line("AMERICA'S FIRST", 100, 100, 800, 50), line("BOTTLED BOURBON", 100, 170, 800, 50),
    line("DISTILLED IN", 100, 500, 800, 60), line("LOUISVILLE, KY", 100, 580, 800, 60),
  ])]);
  assert.equal(fields.classType.uncertain, true);
  assert.ok(fields.brandName.uncertain || !fields.brandName.value);
  assert.notEqual(fields.brandName.value, "DISTILLED IN LOUISVILLE, KY");
});
