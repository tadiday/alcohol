import { PSM } from "tesseract.js";

// Labels have separate blocks of text rather than a single document column.
// Use the same segmentation for browser uploads and the sample integration check.
export const OCR_PARAMETERS = {
  tessedit_pageseg_mode: PSM.SPARSE_TEXT,
};
