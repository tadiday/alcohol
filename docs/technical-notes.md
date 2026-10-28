# Technical notes

[Back to the README](../README.md)

Details of the evidence rules, design tradeoffs, testing, and implementation. For installation, run commands, a brief overview, and planned work, start with the README.

## Review state and corrections

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

The UI reviews one application at a time. Multi-file uploads are explicitly assigned to its visible ID. The reusable [processApplicationBatch](../lib/application-processor.ts) function also accepts multiple applications, each with its own image list and explicit `applicationId` on every image. It rejects mismatched associations and duplicate IDs before OCR, maintains one concurrency bound across the entire batch, and returns results/latency grouped by application ID. It never infers applications from file order, name, or side label. There is currently no multi-application CSV/manifest import screen.

Adaptive OCR follows this sequence: scan once, locate likely sideways text from uncertain fragments, read small rotated regions, and expand crops when text touches an edge. Full-image rotation remains a fallback for difficult layouts. All useful field evidence from accepted scans is retained.

Multi-image latency grows with image count and complexity; approximately five seconds is a target, not a guaranteed limit. The two-worker bound limits active OCR, but does not cap the number or total decoded size of attached images.

## Design decisions and tradeoffs

| Decision | Benefit | Cost / tradeoff |
| --- | --- | --- |
| Browser-based Tesseract OCR | Label images stay on the user's device; no inference credentials or per-request inference charges. | Speed and memory use depend on the device. Initial OCR assets require network access, and difficult typography remains unreliable. |
| Spatial extraction and deterministic comparisons | Explicit numeric/unit rules and source evidence make findings traceable and repeatable. | Layout and field-role heuristics need maintenance; they do not understand every brand, product description, or regulatory exception. No LLM or hosted vision model is used. |
| Adaptive rotated-region reads | Recovers sideways warning panels without always scanning all four full-image orientations. | Region detection can miss a panel or trigger extra work. Fallback rotations increase latency, and arbitrary perspective/curved surfaces are not corrected. |
| At most two reusable OCR workers | Multiple images can make progress while bounding active OCR work. | Workers consume memory, and larger applications queue. Two workers may still be expensive on low-memory mobile devices. |
| Combine evidence with explicit application/image IDs | Front/back evidence complements each other; repeated matching values produce one finding while preserving their sources. | Conflicting readings require human review; no automatic winner is selected, even if one reading looks more plausible. |
| Conservative incomplete-evidence and warning rules | Failed scans cannot produce an overall pass or definitive missing-field finding. Warning text is checked strictly. | Clean-looking labels can still require manual review, and OCR punctuation errors can appear as mismatches. |
| In-memory review session | Simple deployment with no image-storage backend or account setup. | Reloading loses the review. There is no saved audit trail or resumable submission. |

The prototype prioritizes one application's evidence and review workflow. A batch-processing core is available, but a multi-application import screen and persisted workflow were left outside the current scope.

## Observed deployment checks

On **October 28, 2026**, the deployed URL was checked in a fresh headless Chrome context using real OCR asset downloads and actual image recognition. These are individual observations, not an accuracy benchmark or a performance guarantee:

| Scenario | Observed result |
| --- | --- |
| First front/back scan in a fresh browser context | Both images processed in approximately **3.0 s**, including OCR initialization; combined evidence and source highlights worked. |
| Built-in sample buttons | All three produced their expected findings. First sample scan took **2.7 s**; subsequent sample scans took **0.5–0.6 s** in that session. |
| Supplied Citrus Stomp artwork with a sideways warning | Scanned in **2.4 s** with initialized workers; warning wording, 8.6% ABV, 250 mL, class/type, and producer were read. The brand appeared as `CITRUS _ STOMP` and correctly required review. |
| Multi-image edge cases | Conflicting ABVs, repeated matching values, removal, corrupt-image errors/retry, and a single wraparound image behaved as expected. |
| Access and layout | The site opened without login. No horizontal overflow was observed at a 390 px viewport; no uncaught JavaScript errors occurred in the tested flows. |

The browser smoke checks were run separately from the repository's automated test commands. They do not establish cross-browser support or representative accuracy on real bottle photographs.

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

The sample artwork is fictional and lives in [public/samples](../public/samples). External user images are not added to the repository.

## Implementation

- [app/page.tsx](../app/page.tsx): application state, corrections, sample loading, and coordination of the review workflow.
- [app/hooks/use-label-images.ts](../app/hooks/use-label-images.ts): image collection, preview cleanup, OCR worker lifecycle, progress, retry processing, and latency.
- [app/components/application-form.tsx](../app/components/application-form.tsx): expected fields, detected values, and correction-source selection.
- [app/components/label-images.tsx](../app/components/label-images.tsx): uploads, per-image previews/status, side labels, warning corrections, and sample controls.
- [app/components/application-results.tsx](../app/components/application-results.tsx): findings, status summaries, and OCR diagnostics.
- [app/components/application-evidence.tsx](../app/components/application-evidence.tsx): source evidence list and image-box viewer.
- [lib/application-review.ts](../lib/application-review.ts): application-level evidence grouping, conflict detection, strict warning aggregation, and incomplete-evidence handling.
- [lib/application-processor.ts](../lib/application-processor.ts): bounded image queue and explicit multi-application association.
- [lib/label-evidence.ts](../lib/label-evidence.ts): evidence/source types and original-coordinate box transforms.
- [lib/field-extractor.ts](../lib/field-extractor.ts), [lib/ocr-layout.ts](../lib/ocr-layout.ts): field candidates, spatial panels, confidence, and source observations.
- [lib/label-verifier.ts](../lib/label-verifier.ts): existing deterministic field comparisons and strict warning rules.
- [lib/scan-label.ts](../lib/scan-label.ts), [lib/scan-label-browser.ts](../lib/scan-label-browser.ts): adaptive OCR and browser image preprocessing.

## Remaining limitations

- This is an OCR-assisted prototype with human review, not a production regulatory approval system. Candidate roles, layout detection, and confidence thresholds are heuristics; engine scores are not calibrated probabilities.
- Only the English OCR model is loaded. Multilingual labels have not been evaluated. The checks cover the implemented application fields and standard warning text, not every product-specific labeling requirement or exception.
- Stylized brands, small or curved text, glare, perspective distortion, arbitrary angles, and unusual panels can remain uncertain. Image labels do not compensate for missing or unreadable artwork. Conflicting OCR readings require review rather than automatic adjudication.
- Accuracy has been checked with fictional sample artwork and limited supplied artwork, not a representative labeled dataset. There is no measured precision/recall or guarantee that a successful scan recognized every field correctly.
- Image removal explicitly changes the supplied evidence set; the app cannot verify that every physical label panel was submitted.
- Default Tesseract worker/runtime/language assets require external downloads. Restricted-network deployments must host them locally; no fully offline bundle or service worker is configured.
- The 10 MB limit applies per file; there is no total image-count or decoded-memory budget. Large image sets can exhaust browser memory despite bounded OCR concurrency. There is no user-facing cancellation control, and image changes wait for the active run to finish.
- There is no persistence, submission workflow, COLA integration, or multi-application batch-import UI. Review state is lost on page reload.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Run verification is disabled | Enter an application ID, attach an image or select a sample, and wait for the active scan to finish. Entering expected values alone does not supply image evidence. |
| An image fails or contains no readable text | Read the error on its image card. Retry a transient failure, or remove and replace the image with a clearer crop in a supported format under 10 MB. Other successful images remain available. |
| OCR initialization fails | Check network access to the default Tesseract CDN assets, browser support, and browser console/network errors. A fresh session may need to download the OCR engine and English model. |
| OCR text contains symbols or misses a warning | Inspect the highlighted image evidence and raw diagnostics. Small, stylized, or sideways text may be misread. Use a clearer image, add a close-up under the same application, or transcribe the value after checking the artwork. |
| A matching warning still needs review | This is expected: inspect boldness, legibility, and physical print size manually. |
| Results disappeared after refresh | Review state is held in memory. Reloading starts a new session. |

## Deployment

Import this GitHub repository into Vercel and use the **Next.js** framework preset, repository root (`./`), Node.js **24.x**, and `npm run build`. Leave installation and output-directory settings at their detected defaults. The current app needs no environment variables. The live demo uses this deployment path.

After deploying, test the sample buttons and an actual image upload in a fresh browser session. OCR runs on the visitor's device, so a successful server build alone does not confirm that worker, WebAssembly, and English-language downloads work in that browser/network.
