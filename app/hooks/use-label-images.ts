"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createWorker, type Worker } from "tesseract.js";
import { MAX_OCR_CONCURRENCY, processApplicationBatch, type ImageTask } from "@/lib/application/application-processor";
import { isProcessedImage, type ApplicationImage } from "@/lib/application/application-review";
import type { ImageLabel } from "@/lib/label-evidence";
import { OCR_PARAMETERS } from "@/lib/ocr/ocr-config";
import { scanBrowserLabel } from "@/lib/ocr/scan-label-browser";
import type { ScanPass } from "@/lib/ocr/scan-label";

export type UploadedImage = ApplicationImage & {
  file: File;
  previewUrl: string;
  progress?: string;
};

type WorkerContext = { imageId: string; applicationId: string; pass: ScanPass };

function validateFile(file: File) {
  if (!["image/png", "image/jpeg", "image/webp", "image/bmp"].includes(file.type)) {
    throw new Error("Use a PNG, JPEG, WebP, or BMP image.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("The image exceeds 10 MB. Choose a smaller image.");
  }
}

/**
 * Own uploaded-image state, reusable OCR workers, progress, and processing latency.
 * Preview URLs and workers are released when the review screen unmounts.
 */
export function useLabelImages() {
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [applicationLatencyMs, setApplicationLatencyMs] = useState(0);
  const [lastRunMs, setLastRunMs] = useState<number | null>(null);
  const workers = useRef<Array<Worker | null>>([]);
  const contexts = useRef<WorkerContext[]>([]);
  const mounted = useRef(true);
  const busy = useRef(false);
  const previewUrls = useRef(new Set<string>());

  useEffect(() => {
    mounted.current = true;
    const urls = previewUrls.current;
    const pool = workers.current;

    return () => {
      mounted.current = false;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      for (const worker of pool) void worker?.terminate().catch(() => {});
    };
  }, []);

  // Scan only new or retried images; retain the other images' successful evidence.
  const processImages = useCallback(async (snapshot: UploadedImage[], targetIds: string[], applicationId: string) => {
    if (busy.current) return;
    busy.current = true;
    setIsProcessing(true);
    setError("");

    const updateImage = (id: string, appId: string, update: Partial<UploadedImage>) => {
      if (!mounted.current) return;
      setImages((current) => current.map((image) => (
        image.id === id && image.applicationId === appId ? { ...image, ...update } : image
      )));
    };

    const targets = new Set(targetIds);
    setImages(snapshot.map((image) => targets.has(image.id)
      ? { ...image, status: "pending", scan: undefined, error: undefined, progress: "Queued" }
      : image));
    const tasks: ImageTask<File>[] = snapshot.filter((image) => targets.has(image.id)).map((image) => ({
      id: image.id,
      applicationId: image.applicationId,
      name: image.name,
      label: image.label,
      input: image.file,
    }));

    const recognize = async (task: ImageTask<File>, slot: number) => {
      validateFile(task.input);
      contexts.current[slot] = { imageId: task.id, applicationId: task.applicationId, pass: { rotation: 0 } };

      try {
        let worker = workers.current[slot];
        if (!worker) {
          worker = await new Promise<Worker>((resolve, reject) => {
            void createWorker("eng", 1, {
              errorHandler: (error: unknown) => reject(new Error(String(error))),
              logger: (message) => {
                const context = contexts.current[slot];
                if (!context || message.status !== "recognizing text") return;
                const { pass, imageId, applicationId: appId } = context;
                const progress = `Reading ${pass.region ? "text region" : "image"} at ${pass.rotation}°: ${Math.round(message.progress * 100)}%`;
                updateImage(imageId, appId, { progress });
              },
            }).then(resolve, reject);
          });
          if (!mounted.current) {
            await worker.terminate();
            throw new Error("Review session closed.");
          }
          workers.current[slot] = worker;
          await worker.setParameters(OCR_PARAMETERS);
        }

        return await scanBrowserLabel(worker, task.input, (pass) => {
          contexts.current[slot].pass = pass;
          updateImage(task.id, task.applicationId, {
            progress: pass.region ? `Reading a text region at ${pass.rotation}°` : `Reading image at ${pass.rotation}°`,
          });
        });
      } catch (error) {
        // A retry must start with a fresh worker after a recognition failure.
        const failed = workers.current[slot];
        workers.current[slot] = null;
        await failed?.terminate().catch(() => {});
        throw error;
      }
    };

    try {
      const batch = await processApplicationBatch([{ applicationId, images: tasks }], recognize, {
        concurrency: MAX_OCR_CONCURRENCY,
        onImage: (result) => updateImage(result.id, result.applicationId, {
          ...result,
          progress: result.status === "processing" ? "Preparing scanner..." : undefined,
        }),
      });
      if (mounted.current) {
        const latencyMs = batch.applications[0].latencyMs;
        setApplicationLatencyMs((current) => current + latencyMs);
        setLastRunMs(latencyMs);
      }
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      busy.current = false;
      if (mounted.current) setIsProcessing(false);
    }
  }, []);

  function createImage(file: File, applicationId: string, label: ImageLabel = ""): UploadedImage {
    let previewUrl = "";
    try {
      validateFile(file);
      previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
    } catch {
      // Keep invalid files in the evidence set; the queue reports their errors.
    }
    return { id: crypto.randomUUID(), applicationId, name: file.name, file, previewUrl, label, status: "pending" };
  }

  function revokePreview(image: UploadedImage) {
    if (!image.previewUrl) return;
    URL.revokeObjectURL(image.previewUrl);
    previewUrls.current.delete(image.previewUrl);
  }

  function resetTiming() {
    setApplicationLatencyMs(0);
    setLastRunMs(null);
  }

  function removeImage(id: string) {
    const image = images.find((item) => item.id === id);
    if (image) revokePreview(image);
    const remaining = images.filter((item) => item.id !== id);
    setImages(remaining);
    if (!remaining.length) resetTiming();
  }

  function clearImages() {
    images.forEach(revokePreview);
    setImages([]);
    resetTiming();
    setError("");
  }

  function setImageLabel(id: string, label: ImageLabel) {
    setImages((current) => current.map((image) => image.id === id ? { ...image, label } : image));
  }

  return {
    images,
    successfulImages: images.filter(isProcessedImage),
    isProcessing,
    isBusy: () => busy.current,
    error,
    setError,
    applicationLatencyMs,
    lastRunMs,
    processImages,
    createImage,
    removeImage,
    clearImages,
    setImageLabel,
  };
}
