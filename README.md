# Alcohol Label Verification Assistant

A standalone prototype for comparing an application's expected alcohol-label fields with OCR evidence from one or more label images. Images and OCR remain in the browser; no hosted inference API or image-storage server is used.

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:3000. For production:

```bash
npm run build
npm start
```

## Review one application with multiple images

1. Enter an **Application ID** and the expected brand, class/type, ABV, net contents, and producer/address. Include country of origin for imports.
2. Select **Add label images**. Choose one or multiple PNG, JPEG, WebP, or BMP files, up to 10 MB each. Additional uploads join the same application and expected values.
3. Optionally label each image **Front**, **Back**, **Side**, or **Wraparound**. These are descriptive labels, not rules about where a field must appear. A single wraparound image is supported; separate front and back images are never required.
4. Inspect previews, per-image processing status, and detected fields. Individual images can be removed after the processing run finishes. Clear the image set to change the application ID.
5. Select **Run verification** to evaluate the combined application evidence. Expand **View image evidence** and select a source image to inspect its highlighted bounding box on the original image.

Every image carries its application ID and a separate image ID. The application ID is locked while images are attached, preventing accidental reassignment of existing evidence. Expected values can be edited without repeating OCR.

Manual field corrections require a successfully processed source image; a single available image is selected automatically. Warning transcriptions can be corrected independently in each image card. Corrections are identified as manual and do not claim automated confidence. Adding an image preserves existing corrections; removing images clears corrections and prior displayed results so removed evidence cannot support a decision. Retrying a failed image retains successful scans.

The sample-application buttons replace the current image set and populate the Old Tom expected fields. Each built-in sample is one complete wraparound label: matching details, incorrect ABV, or an invalid title-case warning heading.

## Combined evidence and verification rules

- Each image is scanned independently. Text from different images is never concatenated into a paragraph or joined to fabricate a field.
- One application result is produced per field. A warning on the back satisfies presence even when no warning is read on the front; fields can appear in any image.
- Matching repeated values are grouped using the existing text normalization and numeric comparisons. For example, `45%` and US `90 Proof`, or `750 mL` and `0.75 L`, agree. Supporting observations from every source image remain available.
- Different values produce **Needs review**, displaying all observed alternatives and their sources. A 40% front label and 45% back label cannot silently become a 45% match. A global manual correction does not override an existing image conflict.
- **Not detected in supplied images** is reported only when every supplied image has completed successfully and no reading was found for that field. This describes OCR detection, not proof of physical or regulatory absence.
- If an image is pending, failed, or has no readable text, evidence remains incomplete. Findings require review; no overall pass or definitive missing-field conclusion is available. Each failure names its file and provides **Retry this image**. Invalid files must be replaced or removed.
- Government warnings retain the existing complete-wording, punctuation, uppercase-heading, and proper-name checks. An uppercase warning body is accepted. Repeated equivalent warning statements across images do not become duplicate-warning errors. Different warning wording or heading capitalization across images requires review of both sources. Multiple warning blocks within one image retain the existing review behavior.
- Warning wording that matches still requires visual confirmation of boldness, legibility, and physical print size. Plain OCR cannot establish typography.

## Source images and bounding boxes

Field observations retain their value, supporting text, confidence, application ID, image ID/name, optional side label, and bounding box when available. Boxes from rotated or cropped OCR are transformed back into original-image pixel coordinates. The image viewer highlights those source locations. Manual transcriptions without an OCR location show the source image without inventing a box.

Text is grouped spatially into panels. Each field uses confidence from its own supporting lines, so noisy graphics elsewhere do not lower a reliably read ABV. Ambiguous, clipped, low-confidence, or artifact-containing readings remain review items. Serving sizes are excluded from container net contents. Unfiltered text is available under **Scan diagnostics — raw OCR by image**.

## Processing, batch association, and timing

A bounded queue processes at most **two images concurrently**, with one OCR worker per active slot. Workers are reused. Each failed image is isolated, so other images can finish and their scans remain available for retry/review.

The UI displays the latest run's elapsed application latency and cumulative processing time for the current application session, including initialization, queue wait, failed attempts, and retries. Cumulative time can include images later removed; clearing the set resets the timing. It excludes time spent editing the form between processing runs. Parallel image durations are not added together to estimate elapsed latency.

The UI reviews one application at a time. Multi-file uploads are explicitly assigned to its visible ID. The reusable [processApplicationBatch](lib/application-processor.ts) function also accepts multiple applications, each with its own image list and explicit `applicationId` on every image. It rejects mismatched associations and duplicate IDs before OCR, maintains one concurrency bound across the entire batch, and returns results/latency grouped by application ID. It never infers applications from file order, name, or side label. There is currently no multi-application CSV/manifest import screen.

The same adaptive OCR remains in use: scan once, locate likely sideways text from uncertain fragments, read small rotated regions, and expand crops when text touches an edge. Full-image rotation remains a fallback for difficult layouts. All useful field evidence from accepted scans is retained.

One local integration run processed split front/back sample artwork in **0.85 seconds** on an already initialized Node worker with concurrency 1. This is a small clean fixture, not a browser/cold-start or real-photo latency guarantee. Multi-image latency grows with image count and complexity; approximately five seconds is a target, not a guaranteed limit.

## Tests and sample artwork

```bash
npm test
npm run lint
npm run build
npm run samples:check
```

Unit tests cover front/back combined evidence, one wraparound image, repeated matching values, conflicting ABVs, absence across all successful images, partial image failures and retries, side-label independence, strict warning conflicts, original-coordinate boxes, explicit batch association, and the concurrency bound. Existing field/OCR tests remain in place.

The integration check performs actual Tesseract OCR on all three sample PNGs and rotated variants. It also creates front/back crops in memory and verifies combined evidence, wraparound handling, repeated values, conflicting ABVs, and a corrupt image alongside a successful image. It reports elapsed application latency. Its first run downloads English OCR data and caches it in the system temporary directory; unit tests require no network.

Additional warning/field diagnostics on an external image:

```bash
npm run samples:check -- /absolute/path/to/label.jpeg
npm run samples:check -- /absolute/path/to/publicViewAttachment.jpeg --require-regions --check-citrus
```

`--require-regions` asserts one full scan plus targeted reads; `--check-citrus` uses independently transcribed expectations for the supplied Citrus Stomp artwork. `--benchmark` times four full-image scans for comparison. These diagnostic assertions can fail on genuinely altered warnings or unreadable images.

Regenerate editable SVG sources and bundled PNGs:

```bash
npm run samples:generate
```

The sample artwork is fictional and lives in [public/samples](public/samples). External user images are not added to the repository.

## Implementation

- [app/page.tsx](app/page.tsx): application input, image collection, worker pool, progress, retry, corrections, and combined review.
- [app/components/application-evidence.tsx](app/components/application-evidence.tsx): source evidence list and image-box viewer.
- [lib/application-review.ts](lib/application-review.ts): application-level evidence grouping, conflict detection, strict warning aggregation, and incomplete-evidence handling.
- [lib/application-processor.ts](lib/application-processor.ts): bounded image queue and explicit multi-application association.
- [lib/label-evidence.ts](lib/label-evidence.ts): evidence/source types and original-coordinate box transforms.
- [lib/field-extractor.ts](lib/field-extractor.ts), [lib/ocr-layout.ts](lib/ocr-layout.ts): field candidates, spatial panels, confidence, and source observations.
- [lib/label-verifier.ts](lib/label-verifier.ts): existing deterministic field comparisons and strict warning rules.
- [lib/scan-label.ts](lib/scan-label.ts), [lib/scan-label-browser.ts](lib/scan-label-browser.ts): adaptive OCR and browser image preprocessing.

## Remaining limitations

- This is an OCR-assisted prototype with human review, not a production regulatory approval system. Candidate roles, layout detection, and confidence thresholds are heuristics; engine scores are not calibrated probabilities.
- Stylized brands, small or curved text, glare, perspective distortion, arbitrary angles, and unusual panels can remain uncertain. Image labels do not compensate for missing or unreadable artwork. Conflicting OCR readings require review rather than automatic adjudication.
- Image removal explicitly changes the supplied evidence set; the app cannot verify that every physical label panel was submitted.
- Default Tesseract worker/runtime/language assets require external downloads. Restricted-network deployments must host them locally; no fully offline bundle or service worker is configured.
- There is no persistence, submission workflow, COLA integration, or multi-application batch-import UI. Review state is lost on page reload.
