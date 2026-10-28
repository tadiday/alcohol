import { FIELD_LABELS, normalizeText, numericValues, type ExtractedField, type ExtractedFields, type FieldKey } from "./label-verifier";
import { groupTextPanels } from "../ocr/ocr-layout";
import type { EvidencePage, OcrLine } from "../ocr/scan-label";
import { originalImageBox, unionBoxes } from "../label-evidence";

type Candidate = ExtractedField & { priority: number; identity: string };
const producerPrefix = /^(?:(?:producer|bottler)\s*:\s*|(?:bottled|produced|distilled|brewed|canned)(?:\s*(?:&|and)\s*(?:bottled|produced|distilled|brewed|canned))?\s+by\s*)(.*)$/i;
const originPrefix = /^(?:(?:country(?: of origin)?|origin)\s*:\s*|(?:product of|made in|produced in)\s+)(.+)$/i;
const classPrefix = /^(?:class\s*\/\s*type|class|type)\s*:\s*(.+)$/i;
const brandPrefix = /^brand(?: name)?\s*:\s*(.+)$/i;
const beverageType = /\b(?:wine|whisk(?:e)?y|bourbon|vodka|gin|rum|tequila|beer|ale|lager|stout|porter|cider|brandy|liqueur|sake|mezcal)\b/i;
const recipeOrNutrition = /\b(?:cup|shot|recipe|serving|servings|calories|carbohydrates|protein|fat)\b|https?:|www\.|\.[a-z]{2,}\b/i;
const address = /,\s*[A-Z]{2}\b|\b\d{5}(?:-\d{4})?\b|\b(?:street|road|avenue|lane|drive|st\.|rd\.|ave\.)\b/i;
const marketingCopy = /\b(?:first|finest|perfect|best|celebrate|enjoy|discover|cocktail|sipping)\b/i;
const productionStatement = /^(?:produced|distilled|brewed|bottled|made|canned)\s+(?:in|by)\b/i;

function choose(candidates: Candidate[], key: FieldKey): ExtractedField {
  if (!candidates.length) return { value: "", uncertain: true, confidence: null, evidence: "", notes: ["No reliable label text was found for this field. Check the image."] };
  candidates.sort((a, b) => b.priority - a.priority || (b.confidence ?? 0) - (a.confidence ?? 0));
  const top = candidates[0];
  const numeric = key === "alcoholContent" || key === "netContents";
  const peers = candidates.filter((candidate) => (numeric || candidate.priority >= top.priority * 0.9) && (candidate.confidence ?? 0) >= 70);
  const competing = peers.some((candidate) => candidate.identity !== top.identity);
  const result: ExtractedField = {
    value: top.value, uncertain: top.uncertain, confidence: top.confidence,
    evidence: top.evidence, source: top.source, notes: top.notes,
    observations: [...new Set([top, ...peers])].flatMap((candidate) => candidate.observations ?? []),
  };
  if (competing) {
    result.uncertain = true;
    result.notes = ["Multiple plausible label values were found. Confirm the correct value on the image."];
    result.evidence = [...new Set(peers.map((candidate) => candidate.evidence))].join("\n\n");
  }
  return result;
}

export function extractSpatialFields(pages: EvidencePage[]): ExtractedFields {
  const candidates: Record<FieldKey, Candidate[]> = {
    brandName: [], classType: [], alcoholContent: [], netContents: [], producerName: [], countryOfOrigin: [],
  };
  for (const page of pages) {
    const source = page.region ? `Text region read at ${page.rotation}°` : `Label read at ${page.rotation}°`;
    const add = (key: FieldKey, value: string, lines: OcrLine[], priority: number, identity = normalizeText(value)) => {
      if (!value.trim() || !lines.length) return;
      const confidence = Math.min(...lines.map((line) => line.confidence));
      const clipped = !!page.region && lines.some((line) => line.bbox.x0 <= 2 || line.bbox.y0 <= 2
        || line.bbox.x1 >= page.width - 2 || line.bbox.y1 >= page.height - 2);
      const artifact = key === "brandName" && /(?:^|\s)[_~|]+(?=\s|$)/.test(value);
      const bounds = unionBoxes(lines.map((line) => line.bbox));
      candidates[key].push({ value: value.trim(), confidence, uncertain: confidence < 70 || clipped || artifact,
        evidence: lines.map((line) => line.text.trim()).join("\n"), source, priority, identity,
        notes: artifact ? ["The brand reading contains a possible OCR artifact. Confirm the complete name on the image."]
          : clipped ? ["Text touches the crop edge. Check the full label before comparing."]
          : confidence < 70 ? ["This field's text has low OCR confidence. Confirm it on the image."] : [],
        observations: [{ value: value.trim(), text: lines.map((line) => line.text.trim()).join("\n"),
          confidence, image: page.image, rotation: page.rotation,
          bbox: bounds ? originalImageBox(bounds, page) : undefined,
          uncertain: confidence < 70 || clipped || artifact }],
      });
    };

    for (const panel of groupTextPanels(page.lines)) {
      const lines = panel.lines;
      const marketingPanel = lines.some((line) => marketingCopy.test(line.text));
      // Warning statements are checked separately; their words cannot supply
      // brand, beverage type, or producer values.
      if (lines.some((line) => /government\s+warning/i.test(line.text))) continue;
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const text = line.text.trim();
        const producer = producerPrefix.exec(text);
        if (producer) {
          const selected = [line];
          let value = producer[1];
          let next = index + 1;
          if (!value && lines[next] && !originPrefix.test(lines[next].text)) {
            selected.push(lines[next]);
            value = lines[next++].text.trim();
          }
          for (; next < Math.min(lines.length, index + 4); next++) {
            if (!address.test(lines[next].text) || originPrefix.test(lines[next].text)) break;
            selected.push(lines[next]);
            value += `, ${lines[next].text.trim()}`;
          }
          add("producerName", value, selected, 100);
        }
        const origin = originPrefix.exec(text);
        if (origin) add("countryOfOrigin", origin[1], [line], 100);
        const explicitBrand = brandPrefix.exec(text);
        if (explicitBrand) add("brandName", explicitBrand[1], [line], 10000);
        const explicitType = classPrefix.exec(text);
        if (explicitType) add("classType", explicitType[1], [line], 100);
        else if (beverageType.test(text) && !recipeOrNutrition.test(text) && !producer && !origin) {
          add("classType", text, [line], 80);
          if (marketingPanel
            || numericValues(text, "alcohol").values.length || numericValues(text, "volume").values.length) {
            const candidate = candidates.classType.at(-1)!;
            candidate.uncertain = true;
            candidate.notes = ["The beverage type appears with other information. Confirm the exact class/type on the image."];
          }
        }

        const alcohol = numericValues(text, "alcohol");
        const alcoholContext = /\b(?:alcohol|abv|alc|proof)\b/i.test(text);
        const nutrition = /\b(?:serving|servings|calories|carbohydrates|protein|fat|sugar)\b/i.test(text);
        if (alcohol.values.length && (alcoholContext || !nutrition)) {
          const context = lines.slice(Math.max(0, index - 1), index + 2).filter((neighbor) => /\b(?:alc|abv|alcohol)\b/i.test(neighbor.text));
          const evidence = [...new Set([line, ...context])];
          add("alcoholContent", alcohol.evidence, evidence, alcoholContext || context.length ? 100 : 80, alcohol.values.join(";"));
          if (alcohol.invalid || alcohol.values.length !== 1) candidates.alcoholContent.at(-1)!.uncertain = true;
        }
        const volume = numericValues(text, "volume");
        // A serving size is not the container's net contents.
        if (volume.values.length && !nutrition && !/\b(?:cup|shot|recipe)\b/i.test(text)) {
          const standalone = /^(?:net\s*(?:contents|volume)?\s*:?\s*)?(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*(?:ml|cl|l|millilit(?:er|re)s?|lit(?:er|re)s?)\.?$/i.test(text);
          add("netContents", volume.evidence, [line], standalone ? 100 : 70, volume.values.join(";"));
          if (volume.invalid || volume.values.length !== 1) candidates.netContents.at(-1)!.uncertain = true;
        }
      }

      const panelText = lines.map((line) => line.text.trim()).join(" ");
      // A brand candidate must be a compact prominent block. Preserve every
      // line in it, including uncertain text; never fill a brand from the form.
      if (panelText.length >= 3 && panelText.length <= 110 && /\p{L}{3}/u.test(panelText)
        && !beverageType.test(panelText) && !producerPrefix.test(panelText) && !originPrefix.test(panelText) && !productionStatement.test(panelText)
        && !recipeOrNutrition.test(panelText) && !/\d|%|\b(?:warning|calories|gluten|vegan)\b/i.test(panelText)) {
        const height = Math.max(...lines.map((line) => line.bbox.y1 - line.bbox.y0));
        add("brandName", panelText, lines, height);
      }
    }
  }
  const fields = Object.fromEntries((Object.keys(FIELD_LABELS) as FieldKey[]).map((key) => [key, choose(candidates[key], key)])) as ExtractedFields;
  const corroboratingField = (Object.keys(FIELD_LABELS) as FieldKey[]).some((key) => key !== "brandName"
    && !!fields[key].value && !fields[key].uncertain);
  if (fields.brandName.value && !fields.brandName.uncertain && !corroboratingField
    && !candidates.brandName.some((candidate) => candidate.priority === 10000)) {
    fields.brandName.uncertain = true;
    fields.brandName.notes = ["Prominent text was found, but its role as a brand could not be confirmed. Check the image."];
  }
  return fields;
}
