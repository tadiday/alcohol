import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { GOVERNMENT_WARNING } from "../lib/verification/label-verifier";
import { SAMPLE_APPLICATION, SAMPLE_LABELS } from "../lib/sample-labels";

function escapeXml(text: string) {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]!);
}

function wrapWords(text: string, maxCharacters: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const previous = lines.at(-1);
    if (previous && previous.length + word.length + 1 <= maxCharacters) {
      lines[lines.length - 1] += ` ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines;
}

/** Generate reproducible SVG/PNG fixtures, varying ABV or heading case for mismatch demos. */
async function main() {
  const outputDirectory = new URL("../public/samples/", import.meta.url);
  await mkdir(outputDirectory, { recursive: true });

  for (const sample of SAMPLE_LABELS) {
    const alcohol = sample.id === "wrong-abv" ? "40% Alc./Vol. (80 Proof)" : SAMPLE_APPLICATION.alcoholContent;
    const heading = sample.id === "invalid-warning" ? "Government Warning:" : "GOVERNMENT WARNING:";
    const warningLines = wrapWords(GOVERNMENT_WARNING.slice("GOVERNMENT WARNING: ".length), 76);
    const text = (y: number, content: string, size = 40, bold = false, centered = true) =>
      `<text x="${centered ? 800 : 112}" y="${y}" font-size="${size}" font-weight="${bold ? 700 : 400}" text-anchor="${centered ? "middle" : "start"}">${escapeXml(content)}</text>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200">
  <rect width="1600" height="1200" fill="#fffdf6"/>
  <rect x="45" y="45" width="1510" height="1110" rx="8" fill="none" stroke="#58412a" stroke-width="4"/>
  <g fill="#191919" font-family="Arial, Helvetica, sans-serif">
    ${text(180, SAMPLE_APPLICATION.brandName, 56, true)}
    <path d="M190 235 H1410" stroke="#58412a" stroke-width="2"/>
    ${text(325, SAMPLE_APPLICATION.classType, 48)}
    ${text(430, alcohol, 48)}
    ${text(520, SAMPLE_APPLICATION.netContents, 44)}
    ${text(620, `Bottled by ${SAMPLE_APPLICATION.producerName}`, 36)}
    ${text(680, `Product of ${SAMPLE_APPLICATION.countryOfOrigin}`, 32)}
    <path d="M112 735 H1488" stroke="#58412a" stroke-width="2"/>
    ${text(800, heading, 38, true, false)}
    ${warningLines.map((line, index) => text(858 + index * 49, line, 32, false, false)).join("\n    ")}
    ${text(1110, "FICTIONAL DEMO LABEL - FOR SOFTWARE TESTING ONLY", 23)}
  </g>
</svg>\n`;
    const filename = sample.src.split("/").at(-1)!;
    await writeFile(new URL(filename.replace(".png", ".svg"), outputDirectory), svg);
    await sharp(Buffer.from(svg)).png().toFile(new URL(filename, outputDirectory).pathname);
    console.log(`Generated ${sample.src}`);
  }
}

void main();
