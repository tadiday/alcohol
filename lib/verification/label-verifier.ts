import type { ValueEvidence } from "../label-evidence";

export type ComparisonStatus = "match" | "mismatch" | "needs-review";

export interface ComparisonResult {
  field: string;
  status: ComparisonStatus;
  notes: string[];
  extracted?: string;
  expected?: string;
  confidence?: number | null;
  evidence?: string;
  source?: string;
  observations?: ValueEvidence[];
  detection?: "detected" | "not-detected" | "unavailable";
}

export const FIELD_LABELS = {
  brandName: "Brand Name",
  classType: "Class / Type",
  alcoholContent: "Alcohol Content",
  netContents: "Net Contents",
  producerName: "Producer / Bottler",
  countryOfOrigin: "Country of Origin",
} as const;

export type FieldKey = keyof typeof FIELD_LABELS;
export type ApplicationFields = Record<FieldKey, string>;
export type ExtractedField = {
  value: string;
  uncertain: boolean;
  confidence?: number | null;
  evidence?: string;
  source?: string;
  notes?: string[];
  observations?: ValueEvidence[];
};
export type ExtractedFields = Record<FieldKey, ExtractedField>;

export const GOVERNMENT_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’‘]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

type NumericValues = { values: number[]; evidence: string; invalid: boolean };

export function numericValues(text: string, kind: "alcohol" | "volume"): NumericValues {
  // Match the complete number: never accept the 5% inside 45% or 145%.
  const pattern = kind === "alcohol"
    ? /(?<![\p{L}\d.,+\-])(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*(?:%|proof\b)/giu
    : /(?<![\p{L}\d.,+\-])(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*(?:ml\b|cl\b|l\b|millilit(?:er|re)s?\b|lit(?:er|re)s?\b)/giu;
  const matches = Array.from(text.matchAll(pattern), (match) => match[0]);
  let invalid = false;
  const values = matches.map((match) => {
    const number = Number.parseFloat(match.replace(",", "."));
    let value = number;
    if (kind === "alcohol") {
      if (/proof/i.test(match)) value /= 2;
      if (value < 0 || value > 100) invalid = true;
    } else {
      const unit = match.replace(/^[\d.,]+\s*/, "");
      if (/^(?:l|lit(?:er|re)s?)$/i.test(unit)) value *= 1000;
      if (/^cl$/i.test(unit)) value *= 10;
      if (value <= 0) invalid = true;
    }
    return Math.round(value * 10000) / 10000;
  });
  return { values: [...new Set(values)], evidence: matches.join("; "), invalid };
}

export function compareField(expected: string, extracted: string, field = "Field"): ComparisonResult {
  const result = (status: ComparisonStatus, note: string): ComparisonResult => ({
    field, status, notes: [note], expected, extracted,
  });
  if (!expected.trim() || !extracted.trim()) {
    return result("needs-review", "An application value or readable label value is missing.");
  }

  const kind = field === FIELD_LABELS.alcoholContent ? "alcohol"
    : field === FIELD_LABELS.netContents ? "volume" : null;
  if (kind) {
    const application = numericValues(expected, kind);
    const label = numericValues(extracted, kind);
    if (application.invalid || application.values.length !== 1) {
      return result("needs-review", "The application value is unsupported, invalid, or internally inconsistent.");
    }
    if (label.invalid || label.values.length !== 1) {
      return result("needs-review", "The label value is missing, unsupported, or ambiguous. Check the artwork.");
    }
    return application.values[0] === label.values[0]
      ? result("match", `${field} matches after converting equivalent units.`)
      : result("mismatch", `${field} differs from the application.`);
  }

  const expectedNorm = normalizeText(expected);
  const extractedNorm = normalizeText(extracted);
  if (!expectedNorm || !extractedNorm) return result("needs-review", "No readable text to compare.");
  return expectedNorm === extractedNorm
    ? result("match", `${field} matches, allowing differences in capitalization, spacing, and punctuation.`)
    : result("mismatch", `${field} differs from the application.`);
}

const fieldPrefixes: Record<FieldKey, RegExp> = {
  brandName: /^(?:brand(?: name)?)\s*:\s*(.+)$/i,
  classType: /^(?:class\s*\/\s*type|class|type)\s*:\s*(.+)$/i,
  alcoholContent: /^(?:alcohol(?: content)?|abv)\s*:\s*(.+)$/i,
  netContents: /^(?:net contents|volume)\s*:\s*(.+)$/i,
  producerName: /^(?:(?:producer|bottler)\s*:\s*|(?:bottled|produced|distilled|brewed)(?: and bottled)? by\s+)(.+)$/i,
  countryOfOrigin: /^(?:(?:country(?: of origin)?|origin)\s*:\s*|(?:product of|made in|produced in)\s+)(.+)$/i,
};

export function extractLabelFields(text: string, expected: ApplicationFields): ExtractedFields {
  // Exclude warning text without dropping label fields that follow it.
  const fieldText = text.replace(/government\s+warning\s*:[\s\S]*?(?:health\s+problems\.|$)/gi, "\n");
  const lines = fieldText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const extracted = {} as ExtractedFields;
  for (const key of Object.keys(FIELD_LABELS) as FieldKey[]) {
    if (key === "alcoholContent" || key === "netContents") {
      const numeric = numericValues(fieldText, key === "alcoholContent" ? "alcohol" : "volume");
      extracted[key] = { value: numeric.evidence, uncertain: numeric.invalid || numeric.values.length !== 1 };
      continue;
    }
    const explicit = lines.flatMap((line, index) => {
      const match = line.match(fieldPrefixes[key]);
      if (!match) return [];
      const wrapped = [0, 1, 2].map((count) => [match[1], ...lines.slice(index + 1, index + 1 + count)].join(" "));
      return [wrapped.find((candidate) => normalizeText(candidate) === normalizeText(expected[key])) ?? match[1]];
    });
    if (explicit.length) {
      extracted[key] = { value: explicit.join("\n"), uncertain: explicit.length !== 1 };
      continue;
    }
    // Application hints locate whole lines only. Partial strings cannot establish a match.
    // Wrapped text can span up to three consecutive OCR lines.
    const candidates = lines.flatMap((_, index) => [1, 2, 3].map((count) => lines.slice(index, index + count).join(" ")));
    const exact = candidates.find((candidate) => normalizeText(candidate) === normalizeText(expected[key]));
    extracted[key] = { value: exact ?? "", uncertain: !exact };
  }
  return extracted;
}

export function extractWarningBlock(labelText: string): string {
  const heading = /government\s+warning\s*:/i.exec(labelText);
  if (!heading) return "";
  const tail = labelText.slice(heading.index);
  const ending = /health\s+problems\./i.exec(tail);
  return (ending ? tail.slice(0, ending.index + ending[0].length) : tail).replace(/\s+/g, " ").trim();
}

export function warningWordingMatches(warning: string): boolean {
  const normalizeWarning = (value: string) => value
    .replace(/\s+/g, " ")
    .replace(/\(([12])\)\s*/g, "($1) ")
    .trim()
    .toLowerCase();
  return normalizeWarning(warning) === normalizeWarning(GOVERNMENT_WARNING);
}

export function verifyGovernmentWarning(labelText: string): ComparisonResult {
  const base = { field: "Government Warning", expected: GOVERNMENT_WARNING };
  if (!labelText.trim()) {
    return { ...base, status: "needs-review", notes: ["No readable label text. Check the warning on the artwork."], extracted: "" };
  }
  const headings = [...labelText.matchAll(/government\s+warning\s*:/gi)];
  if (!headings.length) {
    return { ...base, status: "needs-review", notes: ["The scanner could not read a GOVERNMENT WARNING: heading. The warning may be rotated, obscured, or missing. Check the artwork."], extracted: "" };
  }
  if (headings.length > 1) {
    return { ...base, status: "needs-review", notes: ["Multiple warning blocks were detected. Review the artwork."], extracted: labelText.slice(headings[0].index) };
  }
  const warning = extractWarningBlock(labelText);
  const headingIsUppercase = /^GOVERNMENT WARNING:/.test(warning);
  const properNamesAreCapitalized = /\b(?:Surgeon|SURGEON) (?:General|GENERAL)\b/.test(warning);
  if (!headingIsUppercase || !properNamesAreCapitalized || !warningWordingMatches(warning)) {
    return {
      ...base, status: "mismatch", extracted: warning,
      notes: ["The warning must have the complete standard wording and uppercase GOVERNMENT WARNING: heading. Surgeon General must be capitalized. Check OCR errors against the artwork; an uppercase body and differences in line wrapping are accepted."],
    };
  }
  return {
    ...base, status: "needs-review", extracted: warning,
    notes: ["Warning wording and uppercase heading match.", "Confirm that GOVERNMENT WARNING: is bold and legible on the artwork. Plain OCR text cannot establish formatting."],
  };
}

export function verifyLabel(
  application: ApplicationFields,
  text: string,
  options: {
    isImported?: boolean;
    confidence?: number | null;
    overrides?: Partial<ApplicationFields>;
    warning?: { text: string; confidence: number; manuallyEdited?: boolean } | null;
    fields?: ExtractedFields;
  } = {},
): ComparisonResult[] {
  const extracted = options.fields ?? extractLabelFields(text, application);
  const keys = (Object.keys(FIELD_LABELS) as FieldKey[]).filter((key) => key !== "countryOfOrigin" || options.isImported);
  const results = keys.map((key) => {
    const correction = options.overrides?.[key];
    const value = correction !== undefined ? { value: correction, uncertain: false } : extracted[key];
    const result = compareField(application[key], value.value, FIELD_LABELS[key]);
    result.confidence = correction !== undefined ? null
      : options.fields ? extracted[key].confidence ?? null : options.confidence ?? null;
    result.evidence = correction !== undefined ? correction : extracted[key].evidence ?? value.value;
    result.source = correction !== undefined ? "Manual correction" : extracted[key].source;
    result.observations = extracted[key].observations;
    if (correction !== undefined) result.notes.push("Uses a manually corrected label value.");
    if (value.uncertain) {
      result.status = "needs-review";
      result.notes = extracted[key].notes?.length ? [...extracted[key].notes!]
        : ["Could not isolate one reliable label value. Check the artwork and extracted text."];
    }
    return result;
  });
  results.push(verifyGovernmentWarning(options.warning?.text ?? text));
  return results.map((result) => {
    const confidence = result.field === "Government Warning"
      ? options.warning?.manuallyEdited ? null : options.warning?.confidence ?? options.confidence : result.confidence;
    if (result.field === "Government Warning") {
      result.confidence = confidence ?? null;
      result.evidence = result.extracted;
      result.source = options.warning?.manuallyEdited ? "Manual correction" : "Detected warning";
      if (options.warning?.manuallyEdited) result.notes.push("Uses manually corrected warning text.");
    }
    if (confidence == null || confidence >= 70) return result;
    return {
      ...result,
      status: "needs-review",
      notes: [...result.notes, "OCR confidence is low. Confirm this finding against the artwork."],
    };
  });
}
