import { extractSpatialFields } from "./field-extractor";
import { FIELD_LABELS, GOVERNMENT_WARNING, extractWarningBlock, normalizeText, numericValues, verifyGovernmentWarning, verifyLabel,
  type ApplicationFields, type ComparisonResult, type ExtractedField, type ExtractedFields, type FieldKey } from "./label-verifier";
import type { ImageLabel, ImageSource, ValueEvidence } from "./label-evidence";
import type { LabelScan } from "./scan-label";

export type ApplicationImage = {
  id: string;
  applicationId: string;
  name: string;
  label?: ImageLabel;
  status: "pending" | "processing" | "success" | "error";
  scan?: LabelScan;
  error?: string;
  durationMs?: number;
};

export type ProcessedApplicationImage = ApplicationImage & { status: "success"; scan: LabelScan };

export function isProcessedImage<T extends ApplicationImage>(image: T): image is T & ProcessedApplicationImage {
  return image.status === "success" && image.scan !== undefined;
}

export type ApplicationReview = {
  applicationId: string;
  complete: boolean;
  status: "match" | "mismatch" | "needs-review";
  fields: ExtractedFields;
  results: ComparisonResult[];
  warningPresence: "found" | "not-detected" | "unavailable";
  processedImages: number;
  totalImages: number;
};

type ReviewOptions = {
  isImported?: boolean;
  overrides?: Partial<ApplicationFields>;
  warningCorrections?: Record<string, string>;
  correctionSources?: Partial<Record<FieldKey, string>>;
};

const FIELD_KEYS = Object.keys(FIELD_LABELS) as FieldKey[];

export function validateImageAssociation(applicationId: string, images: Pick<ApplicationImage, "id" | "applicationId">[]) {
  if (!applicationId.trim()) throw new Error("An application ID is required.");
  const ids = new Set<string>();
  for (const image of images) {
    if (!image.id || image.applicationId !== applicationId) throw new Error("Every image must explicitly belong to this application ID.");
    if (ids.has(image.id)) throw new Error(`Duplicate image ID in application ${applicationId}.`);
    ids.add(image.id);
  }
}

export function fieldValueIdentity(field: FieldKey, value: string): string {
  if (field === "alcoholContent" || field === "netContents") {
    const parsed = numericValues(value, field === "alcoholContent" ? "alcohol" : "volume");
    if (!parsed.invalid && parsed.values.length === 1) return `number:${parsed.values[0]}`;
  }
  return `text:${normalizeText(value)}`;
}

function uniqueEvidence(values: ValueEvidence[]): ValueEvidence[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify([value.image?.applicationId, value.image?.imageId, value.value, value.text, value.bbox]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function imageSource(image: ApplicationImage): ImageSource {
  const original = image.scan?.pages[0];
  return { applicationId: image.applicationId, imageId: image.id, imageName: image.name, imageLabel: image.label,
    width: original?.width, height: original?.height };
}

function warningIdentity(text: string): string {
  const headings = [...text.matchAll(/government\s+warning\s*:/gi)];
  const block = headings.length === 1 ? extractWarningBlock(text) : text;
  const normalized = block.replace(/\s+/g, " ").replace(/\(([12])\)\s*/g, "($1) ").trim();
  return JSON.stringify([/^GOVERNMENT WARNING:/.test(normalized),
    /\b(?:Surgeon|SURGEON) (?:General|GENERAL)\b/.test(normalized), normalized.toLowerCase()]);
}

function groupEvidence(observations: ValueEvidence[], identify: (entry: ValueEvidence) => string): ValueEvidence[][] {
  const groups = new Map<string, ValueEvidence[]>();
  for (const observation of observations) {
    const identity = identify(observation);
    const group = groups.get(identity);
    if (group) group.push(observation);
    else groups.set(identity, [observation]);
  }
  return [...groups.values()];
}

function mergeFieldReadings(key: FieldKey, readings: { image: ProcessedApplicationImage; field: ExtractedField }[]) {
  const observations = uniqueEvidence(readings.flatMap(({ image, field }) => (
    field.observations?.length ? field.observations.map((entry) => ({ ...entry, uncertain: field.uncertain || entry.uncertain }))
      : [{ value: field.value, text: field.evidence ?? field.value, confidence: field.confidence ?? null,
        image: imageSource(image), rotation: 0, uncertain: field.uncertain }]
  )));
  const variants = groupEvidence(observations, (entry) => fieldValueIdentity(key, entry.value));
  const conflict = variants.length > 1;
  const field: ExtractedField = {
    value: variants.map((group) => group[0].value).join(" | "),
    uncertain: variants.length !== 1 || !observations.some((entry) => !entry.uncertain),
    confidence: observations.length ? Math.max(...observations.map((entry) => entry.confidence ?? 0)) : null,
    evidence: observations.map((entry) => `${entry.image?.imageName ?? "Image"}: ${entry.text}`).join("\n\n"),
    source: [...new Set(observations.map((entry) => entry.image?.imageName))].filter(Boolean).join(", "),
    observations,
    notes: conflict ? ["Conflicting values were read in the supplied images. Review every source; no value was selected as authoritative."]
      : readings.flatMap(({ field }) => field.notes ?? []),
  };
  return { field, conflict };
}

function collectWarnings(images: ProcessedApplicationImage[], corrections: Record<string, string> = {}): ValueEvidence[] {
  // Presence is evaluated over the application, never against a required side.
  return images.flatMap((image): ValueEvidence[] => {
    const correction = corrections[image.id];
    const scan = image.scan;
    const text = correction ?? scan.warning?.text ?? "";
    if (!text.trim()) return [];
    return [{ value: text, text, confidence: correction !== undefined ? null : scan.warning?.confidence ?? scan.confidence,
      image: imageSource(image), bbox: scan.warning?.bbox, rotation: scan.warning?.rotation ?? 0 }];
  });
}

function reviewWarnings(warnings: ValueEvidence[]): ComparisonResult {
  const warningGroups = groupEvidence(warnings, (entry) => warningIdentity(entry.text));
  const selected = [...warnings].sort((a, b) => (b.confidence ?? 100) - (a.confidence ?? 100))[0];
  const warningResult: ComparisonResult = selected ? verifyGovernmentWarning(selected.text) : {
    field: "Government Warning", status: "needs-review" as const, expected: GOVERNMENT_WARNING, extracted: "", notes: [],
  };
  warningResult.observations = uniqueEvidence(warnings);
  warningResult.confidence = selected?.confidence ?? null;
  warningResult.evidence = warnings.map((entry) => `${entry.image?.imageName}: ${entry.text}`).join("\n\n");
  warningResult.source = [...new Set(warnings.map((entry) => entry.image?.imageName))].join(", ");
  if (selected && selected.confidence != null && selected.confidence < 70) {
    warningResult.status = "needs-review";
    warningResult.notes.push("The warning reading has low OCR confidence. Check the source image.");
  }
  if (warningGroups.length > 1) {
    warningResult.status = "needs-review";
    warningResult.extracted = warningGroups.map((group) => group[0].text).join("\n\n");
    warningResult.notes = ["The supplied images contain conflicting warning readings. Review each source and its exact wording and heading."];
  }
  return warningResult;
}

export function reviewApplication(
  applicationId: string,
  expected: ApplicationFields,
  images: ApplicationImage[],
  options: ReviewOptions = {},
): ApplicationReview {
  validateImageAssociation(applicationId, images);
  const successful = images.filter(isProcessedImage);
  const complete = images.length > 0 && successful.length === images.length;
  const unavailable = images.filter((image) => !isProcessedImage(image));
  const perImage = successful.map((image) => ({
    image,
    fields: extractSpatialFields(image.scan.pages.map((page) => ({ ...page, image: imageSource(image) }))),
  }));
  const conflicts = new Set<FieldKey>();
  const fields = {} as ExtractedFields;
  for (const key of FIELD_KEYS) {
    const readings = perImage.map(({ image, fields }) => ({ image, field: fields[key] }))
      .filter(({ field }) => field.value.trim());
    const merged = mergeFieldReadings(key, readings);
    fields[key] = merged.field;
    if (merged.conflict) conflicts.add(key);
  }

  const results = verifyLabel(expected, "", { fields, isImported: options.isImported, overrides: options.overrides });
  const warnings = collectWarnings(successful, options.warningCorrections);
  results[results.length - 1] = reviewWarnings(warnings);

  for (const result of results) {
    const key = FIELD_KEYS.find((key) => FIELD_LABELS[key] === result.field);
    let corrected = false;
    if (key && options.overrides?.[key] !== undefined) {
      const sourceId = options.correctionSources?.[key] ?? (successful.length === 1 ? successful[0].id : undefined);
      const source = successful.find((image) => image.id === sourceId);
      if (source) {
        corrected = !!options.overrides[key]?.trim();
        result.observations = [{ value: options.overrides[key]!, text: "Manually transcribed from this image", confidence: null,
          image: imageSource(source), rotation: 0 }, ...(fields[key].observations ?? [])];
      } else {
        result.status = "needs-review";
        result.notes.push("Select a successfully processed source image for this manual correction.");
      }
    }
    const found = result.field === "Government Warning" ? warnings.length > 0 : corrected || !!key && !!fields[key].observations?.length;
    result.detection = found ? "detected" : complete ? "not-detected" : "unavailable";
    if (!found) {
      result.status = "needs-review";
      result.notes = complete ? ["Not detected in supplied images. Check the artwork."]
        : ["Evidence is incomplete. This field may be present in an image that has not been processed successfully."];
    }
    if (key && conflicts.has(key)) {
      result.status = "needs-review";
      result.notes = [...fields[key].notes!];
      result.extracted = fields[key].value;
      result.observations = fields[key].observations;
    }
    if (!complete) {
      result.status = "needs-review";
      result.notes.push(unavailable.length
        ? `Incomplete image evidence: ${unavailable.map((image) => `${image.name} (${image.status === "error" ? "failed" : "not finished"})`).join(", ")}. Retry or remove these images before completing review.`
        : "Add and process label images before completing review.");
    }
  }
  return { applicationId, complete, fields, results, processedImages: successful.length, totalImages: images.length,
    warningPresence: warnings.length ? "found" : complete ? "not-detected" : "unavailable",
    status: !complete || results.some((result) => result.status === "needs-review") ? "needs-review"
      : results.some((result) => result.status === "mismatch") ? "mismatch" : "match",
  };
}
