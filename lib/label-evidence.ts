export type ImageLabel = "" | "Front" | "Back" | "Side" | "Wraparound";
export type BoundingBox = { x0: number; y0: number; x1: number; y1: number };
export type ImageSource = {
  applicationId: string;
  imageId: string;
  imageName: string;
  imageLabel?: ImageLabel;
  width?: number;
  height?: number;
};
export type ValueEvidence = {
  value: string;
  text: string;
  confidence: number | null;
  image?: ImageSource;
  bbox?: BoundingBox;
  rotation: number;
  uncertain?: boolean;
};

export function unionBoxes(boxes: BoundingBox[]): BoundingBox | undefined {
  if (!boxes.length) return undefined;
  return {
    x0: Math.min(...boxes.map((box) => box.x0)), y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)), y1: Math.max(...boxes.map((box) => box.y1)),
  };
}

// Convert OCR coordinates from a rotated/cropped frame to the original image.
export function originalImageBox(box: BoundingBox, frame: {
  rotation: number; width: number; height: number;
  region?: { left: number; top: number; width: number; height: number };
}): BoundingBox {
  const swapped = frame.rotation === 90 || frame.rotation === 270;
  const width = frame.region?.width ?? (swapped ? frame.height : frame.width);
  const height = frame.region?.height ?? (swapped ? frame.width : frame.height);
  const points = [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([x, y]) => {
    const original = frame.rotation === 90 ? [y, height - x]
      : frame.rotation === 180 ? [width - x, height - y]
        : frame.rotation === 270 ? [width - y, x] : [x, y];
    return [Math.min(width, Math.max(0, original[0])) + (frame.region?.left ?? 0),
      Math.min(height, Math.max(0, original[1])) + (frame.region?.top ?? 0)];
  });
  return {
    x0: Math.min(...points.map(([x]) => x)), y0: Math.min(...points.map(([, y]) => y)),
    x1: Math.max(...points.map(([x]) => x)), y1: Math.max(...points.map(([, y]) => y)),
  };
}
