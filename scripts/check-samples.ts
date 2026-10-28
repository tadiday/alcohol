import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "tesseract.js";
import sharp from "sharp";
import { verifyLabel, verifyGovernmentWarning } from "../lib/verification/label-verifier";
import { SAMPLE_APPLICATION, SAMPLE_LABELS } from "../lib/sample-labels";
import { OCR_PARAMETERS } from "../lib/ocr/ocr-config";
import { scanLabelOrientations } from "../lib/ocr/scan-label";
import { extractSpatialFields } from "../lib/verification/field-extractor";
import { reviewApplication } from "../lib/application/application-review";
import { processApplicationBatch } from "../lib/application/application-processor";
import type { LabelScan } from "../lib/ocr/scan-label";

async function checkImage(worker: Awaited<ReturnType<typeof createWorker>>, image: string | Buffer) {
  const metadata = await sharp(image).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Could not read image dimensions");
  return scanLabelOrientations(async (rotation, region) => {
    const source = region ?? { left: 0, top: 0, width: metadata.width!, height: metadata.height! };
    let pipeline = sharp(image);
    if (region) pipeline = pipeline.extract(region);
    const input = rotation === 0 && !region ? image : await pipeline.rotate(rotation).png().toBuffer();
    const { data } = await worker.recognize(input, {}, { text: true, blocks: true });
    return {
      text: data.text,
      confidence: data.confidence,
      width: rotation === 90 || rotation === 270 ? source.height : source.width,
      height: rotation === 90 || rotation === 270 ? source.width : source.height,
      lines: data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines)) ?? [],
    };
  });
}

// This is an explicit integration check: the first run downloads English OCR
// data. Unit tests remain offline and do not need this external dependency.
async function main() {
  const cachePath = join(tmpdir(), "alcohol-sample-ocr");
  await mkdir(cachePath, { recursive: true });
  const started = performance.now();
  const worker = await createWorker("eng", 1, { cachePath });
  console.log(`OCR initialization: ${((performance.now() - started) / 1000).toFixed(2)}s`);

  try {
    await worker.setParameters(OCR_PARAMETERS);
    const sampleScans = new Map<string, LabelScan>();
    for (const sample of SAMPLE_LABELS) {
      const scanStarted = performance.now();
      const image = fileURLToPath(new URL(`../public${sample.src}`, import.meta.url));
      const scan = await checkImage(worker, image);
      sampleScans.set(sample.id, scan);
      const fields = extractSpatialFields(scan.pages);
      const results = verifyLabel(SAMPLE_APPLICATION, scan.text, { confidence: scan.confidence, warning: scan.warning, fields });
      try {
        assert.equal(scan.passes.length, 1, "Readable upright samples should need only one scan");
        assert.ok(scan.confidence >= 70, `Unexpectedly low OCR confidence: ${scan.confidence}`);
        assert.equal(results.length, 6);
        for (const result of results) {
          const expected = result.field === "Government Warning"
            ? sample.id === "invalid-warning" ? "mismatch" : "needs-review"
            : result.field === "Alcohol Content" && sample.id === "wrong-abv" ? "mismatch" : "match";
          assert.equal(result.status, expected, `${sample.id}: ${result.field}`);
        }
      } catch (error) {
        console.error(`OCR text for ${sample.id}:\n${scan.text}\nDetected warning:\n${scan.warning?.text ?? "Not read"}`);
        throw error;
      }
      const seconds = (performance.now() - scanStarted) / 1000;
      console.log(`${sample.name}: expected findings confirmed; ${seconds.toFixed(2)}s; ${Math.round(scan.confidence)}% confidence; ${scan.passes.length} scan(s)`);
    }
    const matchingImage = fileURLToPath(new URL(`../public${SAMPLE_LABELS[0].src}`, import.meta.url));
    const front = await sharp(matchingImage).extract({ left: 0, top: 0, width: 1600, height: 735 }).png().toBuffer();
    const back = await sharp(matchingImage).extract({ left: 0, top: 735, width: 1600, height: 330 }).png().toBuffer();
    const multi = await processApplicationBatch([{ applicationId: "MULTI-DEMO", images: [
      { id: "front", applicationId: "MULTI-DEMO", name: "front.png", label: "Front", input: front },
      { id: "back", applicationId: "MULTI-DEMO", name: "back.png", label: "Back", input: back },
    ] }], (task) => checkImage(worker, task.input), { concurrency: 1 });
    const combined = reviewApplication("MULTI-DEMO", SAMPLE_APPLICATION, multi.applications[0].images);
    assert.equal(combined.complete, true);
    assert.equal(combined.warningPresence, "found");
    assert.equal(combined.results[0].status, "match");
    assert.equal(combined.results.at(-1)!.observations![0].image!.imageId, "back");
    assert.match(combined.results.at(-1)!.notes[0], /wording.*match/);
    console.log(`Front + back: combined evidence verified; ${(multi.applications[0].latencyMs / 1000).toFixed(2)}s application latency (warm Node worker, concurrency 1)`);
    const matchingScan = sampleScans.get("matching")!;
    const wrap = { id: "wrap", applicationId: "WRAP-DEMO", name: "wrap.png", label: "Wraparound" as const, status: "success" as const, scan: matchingScan };
    assert.equal(reviewApplication("WRAP-DEMO", SAMPLE_APPLICATION, [wrap]).warningPresence, "found");
    const repeated = reviewApplication("WRAP-DEMO", SAMPLE_APPLICATION, [wrap, { ...wrap, id: "copy", name: "copy.png" }]);
    assert.equal(repeated.results.find((result) => result.field === "Alcohol Content")!.status, "match");
    const conflict = reviewApplication("WRAP-DEMO", SAMPLE_APPLICATION, [wrap,
      { ...wrap, id: "wrong", name: "wrong.png", scan: sampleScans.get("wrong-abv")! }]);
    assert.equal(conflict.results.find((result) => result.field === "Alcohol Content")!.status, "needs-review");
    const corrupt = await processApplicationBatch([{ applicationId: "FAILURE-DEMO", images: [
      { id: "good", applicationId: "FAILURE-DEMO", name: "good.png", input: front },
      { id: "bad", applicationId: "FAILURE-DEMO", name: "corrupt.png", input: Buffer.from("invalid image bytes") },
    ] }], (task) => checkImage(worker, task.input), { concurrency: 1 });
    const partial = reviewApplication("FAILURE-DEMO", SAMPLE_APPLICATION, corrupt.applications[0].images);
    assert.equal(partial.complete, false);
    assert.equal(partial.warningPresence, "unavailable");
    assert.ok(partial.results.every((result) => result.status === "needs-review"));
    console.log("Wraparound, repeated values, conflicting ABV, and partial image failure verified against real OCR results.");
    for (const rotation of [90, 180, 270]) {
      const input = await sharp(matchingImage).rotate(rotation).png().toBuffer();
      const scan = await checkImage(worker, input);
      assert.ok(scan.warning, `Warning not recovered from ${rotation}° fixture`);
      assert.match(verifyGovernmentWarning(scan.warning.text).notes[0], /wording.*match/);
      console.log(`Rotated ${rotation}° fixture: full warning recovered at ${scan.warning.rotation}°`);
    }
    const suppliedImage = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
    if (suppliedImage) {
      const scanStarted = performance.now();
      const scan = await checkImage(worker, suppliedImage);
      const fields = extractSpatialFields(scan.pages);
      console.log(JSON.stringify({ suppliedImage, seconds: (performance.now() - scanStarted) / 1000, fields,
        warning: scan.warning, passes: scan.passes, usedFallback: scan.usedFallback }, null, 2));
      assert.ok(scan.warning, "No warning heading recovered from supplied image");
      assert.match(scan.warning.text, /^GOVERNMENT WARNING:/);
      assert.ok(scan.warning.confidence >= 70, "Recovered warning is uncertain");
      assert.match(verifyGovernmentWarning(scan.warning.text).notes[0], /wording.*match/);
      if (process.argv.includes("--require-regions")) {
        assert.equal(scan.passes.filter((pass) => !pass.region).length, 1, "Expected only one full-image scan");
        assert.ok(scan.passes.some((pass) => pass.region), "Expected targeted region scanning");
        assert.equal(scan.usedFallback, false);
      }
      if (process.argv.includes("--check-citrus")) {
        // Ground truth transcribed from the supplied real-label artwork. These
        // values are test expectations only; extraction never receives them.
        const application = {
          brandName: "CITRUS STOMP", classType: "LEMON WINE WITH NATURAL FLAVORS AND ARTIFICIAL COLORS",
          alcoholContent: "8.6%", netContents: "250 mL",
          producerName: "EVERGOOD ELIXIRS, Palmer Lake, CO", countryOfOrigin: "",
        };
        const results = verifyLabel(application, scan.text, { confidence: scan.confidence, warning: scan.warning, fields });
        for (const result of results.filter((item) => item.field !== "Government Warning")) {
          assert.equal(result.status, result.field === "Brand Name" ? "needs-review" : "match", `${result.field}: ${JSON.stringify(result)}`);
        }
        console.log("Citrus Stomp: class/type, ABV, volume, and producer match; the brand's OCR artifact remains flagged for review.");
      }
      if (process.argv.includes("--benchmark")) {
        const baselineStarted = performance.now();
        for (const rotation of [0, 90, 180, 270]) {
          const input = rotation === 0 ? suppliedImage : await sharp(suppliedImage).rotate(rotation).png().toBuffer();
          await worker.recognize(input, {}, { text: true, blocks: true });
        }
        console.log(`Four full-image scans on the same worker: ${((performance.now() - baselineStarted) / 1000).toFixed(2)}s`);
      }
    }
  } finally {
    await worker.terminate();
  }
}

const timeout = setTimeout(() => {
  console.error("Sample OCR check timed out. Check access to the OCR language-data host.");
  process.exit(1);
}, 60_000);

main().then(() => clearTimeout(timeout)).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
