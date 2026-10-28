# Alcohol Label Verification Assistant

This app checks whether the details on an alcohol label match the application. Upload one or more images, run OCR, and review the results alongside the source images.

**[Live demo](https://tadiday-alcohol.vercel.app/)**

## Setup and run

Use **Node.js 24.x**, npm, and a modern browser. The app was tested in Chrome. You need internet access to install dependencies and download the OCR files on first use. No API key, `.env` file, or database is needed.

```bash
git clone https://github.com/tadiday/alcohol.git
cd alcohol
npm ci
npm run dev
```

Open http://localhost:3000.

To run a production build locally:

```bash
npm run build
npm run start
```

## Try it

Click a button under **Try a sample application**, wait for the scan to finish, then click **Run verification**. Each sample loads the image and expected values. It replaces any images already attached.

| Sample | What to expect |
| --- | --- |
| Matching label | Five fields match. The warning text matches, but its formatting still needs a visual check. |
| Wrong alcohol content | The image shows 40%; the application expects 45%. |
| Invalid warning heading | The heading uses title case instead of `GOVERNMENT WARNING:`. |

To check your own images:

1. Enter an **Application ID** and the expected brand, class/type, alcohol content, net contents, and producer/address. For imports, also enter the country of origin.
2. Click **Add label images**. Choose PNG, JPEG, WebP, or BMP files, up to 10 MB each.
3. Add optional **Front**, **Back**, **Side**, or **Wraparound** labels. These help you identify the images. A single wraparound image works too.
4. Wait for the scans, then click **Run verification**. Open **View image evidence** to see where a reading came from. The viewer highlights the text when a bounding box is available.
5. Check the artwork before correcting a reading. Retry failed images individually. Successful scans are kept.

| Result | What it means |
| --- | --- |
| Match | The reading matches the expected value. |
| Mismatch | The reading differs from the expected value or warning rule. Check whether OCR read it correctly. |
| Needs review | The reading is unclear, conflicts with another image, is incomplete, or needs a visual check. |

The app only says **Not detected in supplied images** after every image has processed successfully. OCR can miss text, so check the artwork before deciding a field is missing.

## How it works

Tesseract reads the images in the browser. The app groups nearby text, extracts likely field values, and compares them with the application. It scans likely sideways panels separately and uses full-image rotations as a fallback. Up to two images process at once.

Fields can appear in any image. A warning on the back counts even if it is absent from the front. Repeated matching values produce one result. Conflicting values, such as 40% and 45% ABV, show both readings and need review.

Text comparisons allow differences in capitalization, spacing, and punctuation. Numeric comparisons handle equivalent US proof and metric volumes. Warning checks keep the complete wording, punctuation, uppercase heading, and proper-name rules.

| Tool | Used for |
| --- | --- |
| Next.js, React, TypeScript | UI, state, and verification logic. |
| Tailwind CSS | Styling and layout. |
| Tesseract.js | English OCR in the browser. |
| Node.js test runner, tsx, Sharp | Tests, scripts, and sample-image generation. |
| Vercel | Hosting. |

I used browser OCR to keep images on the user's device and avoid a hosted inference service. The tradeoff is that speed depends on the device and the initial downloads. Field extraction uses layout rules, so unusual labels can still need manual review. The app does not use an LLM.

See [technical notes](docs/technical-notes.md) for the full rules, tradeoffs, test details, and troubleshooting.

## Assumptions and limitations

- The entered application values are the comparison baseline. You supply the relevant images under the correct application ID. The app cannot confirm that every label panel was included.
- OCR uses English. Numeric checks support US proof and metric volumes. The app does not cover every beverage-specific rule or exemption.
- Warning text can match and still show **Needs review**. Boldness, legibility, and physical print size need a visual check. The app does not approve labels.
- Small, stylized, curved, poorly lit, or angled text can be misread. OCR confidence is an engine score, not the probability that a reading is correct. Accuracy has not been measured on a representative dataset.
- OCR files download from external sources. Five seconds is the scan-time target, but it is not guaranteed. Large image sets can use too much browser memory.
- Refreshing clears the review. There is no saved history, audit trail, COLA integration, or batch-upload screen for multiple applications.

## Run the checks

```bash
npm test
npm run lint
npm run build
npm run samples:check
```

Tests cover comparisons, warning rules, rotations, multiple images, conflicts, missing fields, failures, retries, source boxes, application IDs, and the processing limit. `samples:check` runs real OCR on the bundled fictional labels. Its first run downloads English OCR data. Unit tests run without network access.

## Project layout

```text
app/
  page.tsx             Application state and review flow
  components/          Form, image cards, results, and evidence viewer
  hooks/               Image state and OCR worker management
lib/
  application/         Combined evidence, conflicts, and processing queue
  ocr/                 Text recognition, layout, and rotations
  verification/        Field extraction and comparison rules
  label-evidence.ts    Source-image types and coordinate conversion
  sample-labels.ts     Demo sample values and metadata
public/samples/        Fictional labels as PNG and editable SVG
scripts/               Sample generation and real-OCR checks
docs/                  Technical notes
```

Tests sit beside the code they cover as `*.test.ts`. Configuration files stay in the repository root.

Start with [the page](app/page.tsx), then [application review](lib/application/application-review.ts), [comparison rules](lib/verification/label-verifier.ts), and [OCR scanning](lib/ocr/scan-label.ts). The [file map](docs/technical-notes.md#implementation) explains the rest.

## Next steps

**Batch uploads across multiple applications** are next. Right now, the UI handles multiple images for one application. The processing code already supports multiple application IDs, but the import screen is not built yet.

The plan is to use a CSV or JSON file that maps each application ID to its expected values and image files. Each application would show its own progress, results, retries, and scan time. Memory limits need to be added and tested before handling hundreds of applications.

Other possible improvements are hosting OCR files locally for restricted networks, saving/exporting reviews, and testing more real label photos. These are future work, not features in this submission.

## AI assistance

I used OpenAI Codex to help with implementation, debugging, tests, and documentation.
