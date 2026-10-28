import type { Worker } from "tesseract.js";
import { scanLabelOrientations, type ScanPass } from "./scan-label";

export async function scanBrowserLabel(worker: Worker, file: File, onPass: (pass: ScanPass) => void) {
  const bitmap = await createImageBitmap(file);
  try {
    return await scanLabelOrientations(async (rotation, region) => {
      let image: File | HTMLCanvasElement = file;
      const source = region ?? { left: 0, top: 0, width: bitmap.width, height: bitmap.height };
      const swapDimensions = rotation === 90 || rotation === 270;
      const width = swapDimensions ? source.height : source.width;
      const height = swapDimensions ? source.width : source.height;
      if (rotation !== 0 || region) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not prepare the rotated label image");
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate(rotation * Math.PI / 180);
        context.drawImage(bitmap, source.left, source.top, source.width, source.height,
          -source.width / 2, -source.height / 2, source.width, source.height);
        image = canvas;
      }
      // Resize the canvas when turning 90°; rotating within the original
      // width/height can clip a warning on the edge of a wraparound label.
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
      return {
        text: data.text,
        confidence: data.confidence,
        width,
        height,
        lines: data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines)) ?? [],
      };
    }, onPass);
  } finally {
    bitmap.close();
  }
}
