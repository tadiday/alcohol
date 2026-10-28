# Alcohol Label Verification Assistant

Compare an application's expected alcohol-label details with text read from one or more label images. Review matches, discrepancies, and supporting image evidence in one place.

**[Open the live demo](https://tadiday-alcohol.vercel.app/)**

## Setup and run

Use **Node.js 24.x**, npm, and a modern browser. Chrome was used for browser checks. Internet access is needed to install dependencies and download the initial OCR assets. No API keys, environment variables, or database are required.

```bash
git clone https://github.com/tadiday/alcohol.git
cd alcohol
npm ci
npm run dev
```

Open http://localhost:3000. For a local production build:

```bash
npm run build
npm run start
```

## Try it

Select a button under **Try a sample application**, wait for the scan, then select **Run verification**. Each sample supplies its own artwork and expected values, replacing the current image set.

| Sample | Expected finding |
| --- | --- |
| Matching label | Five matching fields; warning wording matches, with formatting left for visual review. |
| Wrong alcohol content | 40% on the image differs from the expected 45%. |
| Invalid warning heading | Title-case heading fails the uppercase `GOVERNMENT WARNING:` check. |

To use your own images:

1. Enter an **Application ID** and expected brand, class/type, alcohol content, net contents, and producer/address. Include country of origin for imports.
2. Select **Add label images**. Upload PNG, JPEG, WebP, or BMP files, up to 10 MB each, under the same application.
3. Optionally mark images **Front**, **Back**, **Side**, or **Wraparound**. One wraparound image is enough; fields can appear in any image.
4. Wait for processing, then select **Run verification**. Expand **View image evidence** to inspect the source and highlighted text when a bounding box is available.
5. Check uncertain readings against the artwork before correcting them. Failed images can be retried individually; their missing evidence keeps the application under review.

| Result | Meaning |
| --- | --- |
| Match | The recognized value agrees with the expected value. |
| Mismatch | The reading differs from the expected value or warning rule; check for OCR errors. |
| Needs review | Evidence is uncertain, conflicting, incomplete, or needs a visual check. |

“Not detected in supplied images” appears only after all supplied images process successfully. It describes an OCR result, not proof that the physical label lacks a field.

## Approach and tools

The app runs Tesseract OCR in the browser, groups text spatially, extracts field candidates, and compares the combined evidence with the application. It uses targeted rotated reads for likely sideways panels, with full-image rotations as a fallback. At most two OCR workers process images concurrently.

Text comparisons tolerate capitalization, spacing, and punctuation differences. Numeric comparisons support equivalent units, including US proof and metric volumes. Government warnings use stricter wording, punctuation, heading-case, and proper-name checks. Repeated matching values produce one finding; conflicting values remain **Needs review** with both sources shown.

| Tool | Role |
| --- | --- |
| Next.js, React, TypeScript | Application UI, state, and typed verification logic. |
| Tailwind CSS | Styling and responsive layout. |
| Tesseract.js | Browser-based English OCR; no hosted vision model or LLM is used. |
| Node.js test runner, tsx, Sharp | Unit tests, TypeScript scripts, and sample-image generation/integration checks. |
| Vercel | Deployment. |

Browser OCR keeps images on the user's device and avoids inference credentials, but performance depends on the device and initial asset downloads. Deterministic comparison rules are traceable, while layout and field extraction remain heuristic. See [technical notes](docs/technical-notes.md) for the full rules, tradeoffs, file map, deployment instructions, and troubleshooting.

## Assumptions and limitations

- Entered application values are the comparison baseline. The reviewer supplies the relevant images and associates them with the correct application ID; the app cannot confirm that every physical label panel was submitted.
- The prototype uses English OCR, US proof conversion, and metric volume comparison. It does not evaluate every beverage-specific labeling rule or exemption.
- A matching warning still needs visual review for boldness, legibility, and physical print size. The app assists review and does not issue regulatory approval.
- Small, stylized, curved, poorly lit, or angled text can be misread. OCR confidence is not a calibrated probability; accuracy has not been measured on a representative dataset.
- OCR assets require external downloads. Roughly five seconds is a latency target, not a guarantee. Large image sets can exhaust browser memory despite the two-worker limit.
- Review state is lost on refresh. There is no persistence, audit trail, COLA integration, or multi-application batch-upload screen.

## Tests

```bash
npm test
npm run lint
npm run build
npm run samples:check
```

Tests cover field comparisons, strict warning rules, rotations, combined front/back evidence, wraparound labels, duplicate/conflicting readings, missing fields, failures/retries, source coordinates, application IDs, and bounded concurrency. `samples:check` runs real OCR on the bundled fictional artwork; its first run downloads English OCR data. Unit tests require no network.

## Future work

**Batch uploads across multiple applications** are the next planned enhancement. The UI currently supports multiple images for one application. The existing processing core can already associate images with multiple application IDs, but has no batch-import interface.

A future batch workflow would import a CSV/JSON manifest mapping each application ID to its expected values and image files, validate those associations, and display progress and findings per application. It would retain bounded concurrency, individual retries, and per-application latency measurements. Large-batch memory limits would need to be added and tested before supporting hundreds of applications.

Other possible improvements include hosting OCR assets locally for restricted networks, saving/exporting reviews, and evaluating extraction against a broader set of real label photographs. These features are not part of the current submission.

## AI assistance

I used OpenAI Codex to assist with implementation, debugging, test creation, and documentation.
