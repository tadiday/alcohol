# Technical notes

[Back to the README](../README.md)

This covers the review rules, main design choices, tests, and known limits. Setup and run instructions are in the README.

## Images and corrections

Each image has an application ID and its own image ID. The application ID stays locked while images are attached. Clear the image set to switch applications. You can change the expected values without running OCR again.

A field correction must point to a successfully scanned image. If there is only one, the app selects it automatically. Warning text can be corrected in each image card. Manual corrections are marked as manual and have no OCR confidence score.

Adding an image keeps existing corrections. Removing an image clears corrections and displayed results so removed sources cannot support the review. Retrying a failed image keeps the successful scans.

Sample buttons replace the current images and load the Old Tom expected values. Each sample is one complete wraparound label.

## Review rules

Each image is scanned separately. Fields are extracted from its own text and layout before the results are combined. Text from separate images is not joined to make up a field.

- Fields can appear on any side. A warning read on the back satisfies the presence check for the application.
- Matching values produce one finding and keep all their sources. For example, `45%` and US `90 Proof` agree, as do `750 mL` and `0.75 L`.
- Different values stay visible. If one image shows 40% and another shows 45%, the result is **Needs review**. A manual correction cannot hide that conflict.
- A field is **Not detected in supplied images** only when every supplied image has processed successfully and no reading was found. That does not prove the field is absent from the artwork.
- Pending, failed, or unreadable images keep the review incomplete. Every finding needs review, and there is no overall pass or definite missing-field conclusion. Each failed image has its own error and retry button.

### Government warning

The warning check requires the complete wording and punctuation, uppercase `GOVERNMENT WARNING:`, and correct capitalization of `Surgeon General`. An uppercase body and changes in line wrapping are accepted.

Equivalent warnings repeated across images count as one statement. Different wording or heading capitalization across images needs review. Multiple warning blocks within one image also need review.

Even when the text matches, boldness, legibility, and physical print size still need a visual check. OCR text alone cannot confirm those details.

## Source images and text boxes

A reading keeps its value, supporting text, confidence, application ID, image ID/name, optional side label, and bounding box when available. Boxes from cropped or rotated scans are converted back to coordinates on the original image. The viewer highlights that location.

Manual transcriptions without an OCR box still open the source image. The app does not invent a location for them.

The extractor groups nearby lines into panels. Each field uses confidence from its supporting lines, so noisy artwork elsewhere does not lower a clearly read ABV. Clipped text, possible OCR artifacts, and ambiguous readings need review. Serving sizes are excluded from container net contents.

Open **Scan diagnostics — raw OCR by image** to inspect the unfiltered OCR output.

## OCR and processing

The scan starts with the upright image. It looks for clusters of uncertain text that may be sideways, reads those regions at quarter-turn angles, and expands a crop when text touches its edge. Full-image rotations are the fallback. Useful field readings are kept with their source locations.

Up to **two images process at once**. Each active slot reuses an OCR worker. One image failing does not stop the others.

The UI shows the latest run's elapsed time and the total processing time for the current application session. This includes initialization, queue wait, failures, and retries. It excludes time spent editing the form. The total can include images removed later; clearing the set resets it. Parallel image durations are not added together to calculate elapsed time.

More images and harder layouts take longer. About five seconds is the target, not a guaranteed limit. The two-worker limit controls active OCR work, but does not limit the total number or decoded size of attached images.

### Current batch support

The UI reviews one application at a time. All uploaded images belong to its visible application ID.

[processApplicationBatch](../lib/application/application-processor.ts) also accepts multiple applications in code. Each has an image list, and every image must include its `applicationId`. The function rejects duplicate application IDs, duplicate image IDs within an application, and images assigned to the wrong application. One processing limit applies across the whole batch. Results and elapsed times are returned by application ID.

There is no CSV/JSON import screen yet. The planned batch UI would add explicit file mapping, per-application progress and results, retries, and memory limits. File names, upload order, and side labels would not determine which application an image belongs to.

## Decisions and tradeoffs

| Choice | Reason and tradeoff |
| --- | --- |
| OCR in the browser | Images stay on the user's device, with no inference API key or per-request inference charge. Speed and memory use depend on the device. OCR files still need an initial download. |
| Rule-based extraction and comparison | The rules and source readings are easy to inspect. Unusual layouts and product descriptions can fall outside those rules. No LLM or hosted vision model is used. |
| Targeted rotated reads | Sideways panels can be read without always scanning the whole image four times. Region detection can miss text, and fallback scans add time. Curved surfaces and perspective are not corrected. |
| Two reusable workers | Multiple images can make progress with a fixed limit on active scans. Workers still use memory, and larger sets have to queue. |
| Keep conflicting evidence | Reviewers can see both readings and their sources. The app leaves the choice to the reviewer. |
| Strict warning and incomplete-image rules | Unavailable evidence blocks a complete conclusion. OCR punctuation errors can still cause mismatches that need checking against the artwork. |
| Keep state in memory | No storage backend or account setup is needed. Refreshing loses the review, and there is no saved audit trail. |

The current scope is one application's review flow. A batch-import screen and saved reviews are left for future work.

## Deployment checks

The live app was checked on **October 28, 2026** in a fresh headless Chrome context, using real OCR downloads and image recognition.

| Check | Result |
| --- | --- |
| First front/back scan | About **3.0 seconds**, including OCR initialization. Combined evidence and source highlights worked. |
| Built-in samples | All three gave the expected findings. The first scan took **2.7 seconds**; later scans took **0.5–0.6 seconds** in that session. |
| Citrus Stomp artwork with a sideways warning | **2.4 seconds** with initialized workers. The warning, 8.6% ABV, 250 mL, class/type, and producer were read. The brand came back as `CITRUS _ STOMP` and needed review. |
| Multiple-image cases | Conflicting ABVs, matching repeats, removal, a corrupt-image retry, and a single wraparound image behaved as expected. |
| Access and layout | No login was needed. No horizontal overflow at a 390 px viewport or uncaught JavaScript errors were observed in the tested flows. |

These are individual runs, not an accuracy benchmark or speed guarantee. The browser checks were run separately from the repository's test commands. They do not establish support across browsers or accuracy on real bottle photos.

## Tests and sample artwork

```bash
npm test
npm run lint
npm run build
npm run samples:check
```

Unit tests use controlled text and coordinates to check field comparisons, warning rules, extraction, scan decisions, source boxes, and application aggregation. They cover front/back evidence, a single wraparound image, matching repeats, conflicting ABVs, missing fields, failures, retries, application IDs, and the processing limit. They run without network access.

`samples:check` runs actual Tesseract OCR on the three sample PNGs and rotated versions. It also creates front/back crops in memory and checks combined evidence, repeated values, conflicts, and a corrupt image alongside a valid one. It reports processing time. On first run, it downloads English OCR data and caches it in the system temporary directory.

To check another image:

```bash
npm run samples:check -- /absolute/path/to/label.jpeg
```

For the specific Citrus Stomp artwork used during development:

```bash
npm run samples:check -- /absolute/path/to/publicViewAttachment.jpeg --require-regions --check-citrus
```

`--require-regions` checks that the scan uses one full-image pass and targeted regions. `--check-citrus` compares the readings with manually transcribed expectations for that artwork. `--benchmark` times four full-image scans for comparison. These checks can fail on altered warnings or unreadable images. The external Citrus image is not bundled in the repository.

To regenerate the fictional demo labels:

```bash
npm run samples:generate
```

Editable SVGs and PNGs are in [public/samples](../public/samples).

## Implementation

| File | Responsibility |
| --- | --- |
| [app/page.tsx](../app/page.tsx) | Application inputs, corrections, samples, and review flow. |
| [use-label-images.ts](../app/hooks/use-label-images.ts) | Uploaded images, preview cleanup, workers, progress, retry processing, and timing. |
| [application-form.tsx](../app/components/application-form.tsx) | Expected fields, detected values, and correction sources. |
| [label-images.tsx](../app/components/label-images.tsx) | Uploads, image cards, side labels, warning corrections, and sample buttons. |
| [application-results.tsx](../app/components/application-results.tsx) | Findings, counts, and raw OCR diagnostics. |
| [application-evidence.tsx](../app/components/application-evidence.tsx) | Source lists and highlighted image viewer. |
| [application-review.ts](../lib/application/application-review.ts) | Combine evidence, flag conflicts, review warnings, and track incomplete images. |
| [application-processor.ts](../lib/application/application-processor.ts) | Queue images under explicit application IDs with a shared processing limit. |
| [label-evidence.ts](../lib/label-evidence.ts) | Evidence types and conversion to original-image coordinates. |
| [field-extractor.ts](../lib/verification/field-extractor.ts) | Field candidates, confidence, and supporting text. |
| [ocr-layout.ts](../lib/ocr/ocr-layout.ts) | Group text into panels. |
| [label-verifier.ts](../lib/verification/label-verifier.ts) | Field comparisons and strict warning checks. |
| [scan-label.ts](../lib/ocr/scan-label.ts) | Scan order, candidate regions, rotations, and warning recovery. |
| [scan-label-browser.ts](../lib/ocr/scan-label-browser.ts) | Prepare browser images for cropped and rotated scans. |

## Known limits

- Only English OCR has been used. Multilingual labels have not been evaluated.
- Field extraction uses layout rules. Stylized brands, small text, glare, curves, unusual panels, and angled photos can still produce wrong or unclear readings.
- OCR confidence is an engine score, not the probability that the result is correct. There is no measured precision or recall on a representative dataset. Testing has used fictional samples and limited supplied artwork.
- The checks cover the implemented fields and standard warning text, not every labeling requirement or exception. A person still needs to review the result.
- The app only checks the images supplied. Removing an image changes that set; it cannot confirm that every physical panel was submitted.
- Default worker, runtime, and language files download from external sources. Restricted networks may need those files hosted locally. There is no full offline bundle or service worker.
- The 10 MB limit applies per file. There is no total image-count or decoded-memory limit. Large sets can exhaust browser memory even with two workers.
- There is no cancel button. Image changes wait until the active run finishes.
- Reviews are not saved. There is no audit trail, submission workflow, COLA integration, or batch-import UI.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| Run verification is disabled | Enter an application ID, upload an image or choose a sample, and wait for processing to stop. Expected values alone do not provide an image to check. |
| An image fails or has no readable text | Read its error. Retry a temporary failure, or remove it and add a clearer image in a supported format under 10 MB. Successful scans are kept. |
| OCR cannot start | Check access to the Tesseract CDN files and inspect the browser console/network errors. The browser needs Web Workers, WebAssembly, canvas, and `createImageBitmap`. |
| OCR reads symbols or misses a warning | Check the source image and raw diagnostics. Add a clearer image or close-up under the same application, or correct the text after checking the artwork. |
| Matching warning still needs review | Check boldness, legibility, and physical print size. This is expected. |
| Review disappeared after refresh | State is held in memory. Start a new review. |

## Deploy to Vercel

Import the GitHub repository and use these settings:

| Setting | Value |
| --- | --- |
| Framework | Next.js |
| Root directory | `./` |
| Node.js | `24.x` |
| Build command | `npm run build` |
| Install and output settings | Detected defaults |
| Environment variables | None needed |

After deployment, try the sample buttons and an image upload in a fresh browser session. OCR runs in the browser, so a successful build does not confirm that OCR downloads work on the visitor's network.
