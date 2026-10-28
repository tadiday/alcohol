import test from "node:test";
import assert from "node:assert/strict";

import {
  compareField,
  normalizeText,
  verifyGovernmentWarning,
  verifyLabel,
  extractLabelFields,
  GOVERNMENT_WARNING,
  type ApplicationFields,
} from "./label-verifier";

// These checks compare supplied text directly, separating normalization and strict
// warning rules from image recognition and multi-image evidence aggregation.
test("normalizeText collapses spacing and punctuation differences", () => {
  const value = normalizeText("  OLD TOM  DISTILLERY!  ");
  assert.equal(value, "old tom distillery");
});

test("compareField treats capitalization and punctuation as equivalent", () => {
  const result = compareField("OLD TOM DISTILLERY", "Old Tom Distillery");
  assert.equal(result.status, "match");
});

test("compareField flags substantive mismatch for alcohol content", () => {
  const result = compareField(
    "45% Alc./Vol. (90 Proof)",
    "40% Alc./Vol. (80 Proof)",
    "Alcohol Content"
  );
  assert.equal(result.status, "mismatch");
  assert.match(result.notes[0], /Alcohol/);
});

test("verifyGovernmentWarning enforces uppercase heading and exact wording", () => {
  const result = verifyGovernmentWarning(
    "Government Warning: (1) According to the Surgeon General..."
  );
  assert.equal(result.status, "mismatch");
  assert.match(result.notes[0], /GOVERNMENT WARNING/i);
});


test("complete warning still requires a visual formatting check", () => {
  const compliant =
    "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

  const result = verifyGovernmentWarning(compliant);
  assert.equal(result.status, "needs-review");
  assert.match(result.notes.join(" "), /bold/);
});

const application: ApplicationFields = {
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  producerName: "Old Tom Distillery, Louisville, KY",
  countryOfOrigin: "United States",
};

const label = [
  application.brandName,
  application.classType,
  application.alcoholContent,
  application.netContents,
  `Bottled by ${application.producerName}`,
  `Product of ${application.countryOfOrigin}`,
  GOVERNMENT_WARNING,
].join("\n");

test("partial names cannot pass as complete names", () => {
  assert.equal(compareField("Old Tom Distillery", "Old Tom", "Brand Name").status, "mismatch");
  assert.equal(compareField("Old Tom", "Old Tom Distillery", "Brand Name").status, "mismatch");
});

test("straight and curly apostrophes and capitalization are equivalent", () => {
  assert.equal(compareField("Stone's Throw", "STONE’S THROW").status, "match");
});

test("empty or punctuation-only fields need review", () => {
  assert.equal(compareField("", "Old Tom").status, "needs-review");
  assert.equal(compareField("---", "!!!").status, "needs-review");
});

test("ABV comparison cannot match a substring of a number", () => {
  assert.equal(compareField("45%", "5%", "Alcohol Content").status, "mismatch");
  assert.equal(compareField("5%", "45%", "Alcohol Content").status, "mismatch");
});

test("ABV ignores presentation and supports equivalent US proof", () => {
  assert.equal(compareField("45% Alc./Vol. (90 Proof)", "45.0 % ABV", "Alcohol Content").status, "match");
  assert.equal(compareField("45%", "90 proof", "Alcohol Content").status, "match");
});

test("inconsistent ABV and proof cannot pass", () => {
  assert.equal(compareField("45%", "45% (80 Proof)", "Alcohol Content").status, "needs-review");
  assert.equal(compareField("45% (80 Proof)", "45%", "Alcohol Content").status, "needs-review");
});

test("invalid and unreadable alcohol values need review", () => {
  for (const value of ["145%", "-45%", "unknown", "4S%", "45% or 40%"] ) {
    assert.equal(compareField("45%", value, "Alcohol Content").status, "needs-review", value);
  }
});

test("net contents converts metric units before comparing", () => {
  for (const value of ["0.75 L", ".75 L", "75 cL", "750 milliliters", "0,75 litres"]) {
    assert.equal(compareField("750 mL", value, "Net Contents").status, "match", value);
  }
  assert.equal(compareField("750 mL", "1750 mL", "Net Contents").status, "mismatch");
  assert.equal(compareField("750 mL", "0 mL", "Net Contents").status, "needs-review");
  assert.equal(compareField("750 mL", "25 fl oz", "Net Contents").status, "needs-review");
});

test("truncated warning with the old required keywords fails", () => {
  assert.equal(verifyGovernmentWarning("GOVERNMENT WARNING: According to the Surgeon General drive a car or operate machinery").status, "mismatch");
});

test("removing or altering any warning sentence fails", () => {
  for (const changed of [
    GOVERNMENT_WARNING.replace("because of the risk of birth defects.", ""),
    GOVERNMENT_WARNING.replace("should not", "may"),
    GOVERNMENT_WARNING.replace("and may cause health problems.", ""),
    GOVERNMENT_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:"),
  ]) assert.equal(verifyGovernmentWarning(changed).status, "mismatch");
});

test("wrapped warning matches wording without claiming bold formatting", () => {
  const result = verifyGovernmentWarning(`BRAND\n${GOVERNMENT_WARNING.replaceAll(" ", "\n")}\n750 mL`);
  assert.equal(result.status, "needs-review");
  assert.equal(result.extracted, GOVERNMENT_WARNING);
  assert.match(result.notes[0], /wording.*match/);
});

test("missing, empty, or duplicate warnings cannot pass", () => {
  assert.equal(verifyGovernmentWarning("Old Tom 45% 750 mL").status, "needs-review");
  assert.equal(verifyGovernmentWarning("").status, "needs-review");
  assert.equal(verifyGovernmentWarning(`${GOVERNMENT_WARNING}\n${GOVERNMENT_WARNING}`).status, "needs-review");
});

test("verification checks the label rather than an application warning", () => {
  const results = verifyLabel(application, label.replace(GOVERNMENT_WARNING, ""));
  assert.equal(results.find((result) => result.field === "Government Warning")?.status, "needs-review");
});

test("complete label verifies each field independently", () => {
  const results = verifyLabel(application, label, { isImported: true });
  assert.equal(results.length, 7);
  for (const result of results.filter((item) => item.field !== "Government Warning")) {
    assert.equal(result.status, "match", result.field);
    assert.notEqual(result.extracted, label);
  }
});

test("country of origin is checked only for imports", () => {
  assert.equal(verifyLabel(application, label).some((result) => result.field === "Country of Origin"), false);
  const results = verifyLabel(application, label.replace("Product of United States", ""), { isImported: true });
  assert.equal(results.find((result) => result.field === "Country of Origin")?.status, "needs-review");
});

test("fields following a warning are still extracted", () => {
  const reordered = `${GOVERNMENT_WARNING}\n${label.replace(GOVERNMENT_WARNING, "")}`;
  assert.equal(verifyLabel(application, reordered).find((result) => result.field === "Alcohol Content")?.status, "match");
});

test("explicitly labeled wrong text values are mismatches", () => {
  const results = verifyLabel(application, label.replace(application.brandName, "Brand: Another Distillery"));
  const brand = results.find((result) => result.field === "Brand Name");
  assert.equal(brand?.status, "mismatch");
  assert.equal(brand?.extracted, "Another Distillery");
});

test("partial or unidentified OCR text is uncertain rather than a false match", () => {
  const fields = extractLabelFields("Old Tom\n45%\n750 mL", application);
  assert.equal(fields.brandName.uncertain, true);
  assert.equal(verifyLabel(application, "Old Tom\n45%\n750 mL")[0].status, "needs-review");
});

test("whole multiline names can be found without accepting partial names", () => {
  const fields = extractLabelFields("OLD TOM\nDISTILLERY\n45%", application);
  assert.equal(fields.brandName.value, "OLD TOM DISTILLERY");
  assert.equal(fields.brandName.uncertain, false);
});

test("multiple different alcohol amounts need review", () => {
  const results = verifyLabel(application, label.replace("45% Alc./Vol. (90 Proof)", "45% ABV\n40% ABV"));
  assert.equal(results.find((result) => result.field === "Alcohol Content")?.status, "needs-review");
});

test("low-confidence OCR never presents a definitive automated finding", () => {
  const results = verifyLabel(application, label.replace("45% Alc./Vol. (90 Proof)", "5%"), { confidence: 45 });
  assert.ok(results.every((result) => result.status === "needs-review"));
});

test("manual field corrections are compared and identified", () => {
  const result = verifyLabel(application, label, { overrides: { alcoholContent: "5%" } })
    .find((item) => item.field === "Alcohol Content");
  assert.equal(result?.status, "mismatch");
  assert.equal(result?.extracted, "5%");
  assert.match(result?.notes.join(" ") ?? "", /manually corrected/);
});

test("empty manual corrections do not fall back to an earlier detected value", () => {
  const result = verifyLabel(application, label, { overrides: { brandName: "" } })[0];
  assert.equal(result.status, "needs-review");
  assert.equal(result.extracted, "");
});

test("empty label text cannot pass any field", () => {
  assert.ok(verifyLabel(application, "").every((result) => result.status === "needs-review"));
});

test("an uppercase warning body keeps the exact wording and is accepted for visual review", () => {
  const result = verifyGovernmentWarning(GOVERNMENT_WARNING.toUpperCase());
  assert.equal(result.status, "needs-review");
  assert.match(result.notes[0], /wording.*match/);
});

test("uppercase warning body does not excuse a title-case heading", () => {
  const result = verifyGovernmentWarning(GOVERNMENT_WARNING.toUpperCase().replace("GOVERNMENT WARNING:", "Government Warning:"));
  assert.equal(result.status, "mismatch");
});

test("missing spaces after warning list markers do not change the words", () => {
  const result = verifyGovernmentWarning(GOVERNMENT_WARNING.replace("(1) ", "(1)").replace("(2) ", "(2)"));
  assert.match(result.notes[0], /wording.*match/);
});

test("Surgeon General still needs proper capitalization", () => {
  assert.equal(verifyGovernmentWarning(GOVERNMENT_WARNING.replace("Surgeon General", "surgeon general")).status, "mismatch");
});

test("a recovered warning uses its own confidence and preserves original artwork case", () => {
  const results = verifyLabel(application, "Unreadable upright label", {
    confidence: 40,
    warning: { text: GOVERNMENT_WARNING.toUpperCase(), confidence: 95 },
  });
  const warning = results.find((result) => result.field === "Government Warning")!;
  assert.match(warning.notes[0], /wording.*match/);
  assert.ok(warning.notes.every((note) => !note.includes("confidence is low")));
  assert.equal(warning.extracted, GOVERNMENT_WARNING.toUpperCase());
});

test("low-confidence warning cannot become a definitive mismatch", () => {
  const warning = verifyLabel(application, label, {
    confidence: 95,
    warning: { text: GOVERNMENT_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:"), confidence: 40 },
  }).at(-1)!;
  assert.equal(warning.status, "needs-review");
  assert.match(warning.notes.join(" "), /confidence is low/);
});
