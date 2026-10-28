import { validateImageAssociation, type ApplicationImage } from "./application-review";
import type { LabelScan } from "../ocr/scan-label";

export const MAX_OCR_CONCURRENCY = 2;
export type ImageTask<T> = Pick<ApplicationImage, "id" | "applicationId" | "name" | "label"> & { input: T };
export type ApplicationTask<T> = { applicationId: string; images: ImageTask<T>[] };

/**
 * Process explicitly associated images through one bounded queue across applications.
 * Each slot can reuse an OCR worker; an image failure is recorded without stopping
 * other images. Application latency includes queue wait from the batch start.
 */
export async function processApplicationBatch<T>(applications: ApplicationTask<T>[],
  recognize: (image: ImageTask<T>, workerSlot: number) => Promise<LabelScan>, options: {
    concurrency?: number;
    onImage?: (image: ApplicationImage) => void;
    clock?: () => number;
  } = {}) {
  const appIds = new Set<string>();
  for (const application of applications) {
    if (appIds.has(application.applicationId)) throw new Error("Application IDs must be unique within a batch.");
    appIds.add(application.applicationId);
    validateImageAssociation(application.applicationId, application.images);
  }
  const clock = options.clock ?? (() => performance.now());
  const started = clock();
  const tasks = applications.flatMap((application) => application.images);
  const results: ApplicationImage[] = new Array(tasks.length);
  const finishedAt = new Map<string, number>();
  const requested = options.concurrency ?? MAX_OCR_CONCURRENCY;
  if (!Number.isInteger(requested) || requested < 1) throw new Error("Concurrency must be a positive integer.");
  const concurrency = Math.min(MAX_OCR_CONCURRENCY, requested, tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async (_, slot) => {
    while (next < tasks.length) {
      const index = next++;
      const { input: _input, ...metadata } = tasks[index];
      void _input;
      const imageStarted = clock();
      options.onImage?.({ ...metadata, status: "processing" });
      let result: ApplicationImage;
      try {
        const scan = await recognize(tasks[index], slot);
        if (!scan.pages.some((page) => page.text.trim()) && !scan.warning?.text.trim()) {
          throw new Error("No readable text was found. Try a clearer image or a closer label crop.");
        }
        result = { ...metadata, status: "success", scan, durationMs: clock() - imageStarted };
      } catch (error) {
        result = { ...metadata, status: "error", error: error instanceof Error ? error.message : String(error), durationMs: clock() - imageStarted };
      }
      results[index] = result;
      finishedAt.set(metadata.applicationId, clock());
      options.onImage?.(result);
    }
  }));
  return { durationMs: clock() - started, applications: applications.map((application) => ({
    applicationId: application.applicationId,
    images: results.filter((image) => image.applicationId === application.applicationId),
    // Includes queue wait, initialization, OCR, and failed attempts in this run.
    latencyMs: (finishedAt.get(application.applicationId) ?? started) - started,
  })) };
}
