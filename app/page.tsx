"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createWorker, type Worker } from "tesseract.js";
import { FIELD_LABELS, type ApplicationFields, type FieldKey } from "@/lib/label-verifier";
import { SAMPLE_APPLICATION, SAMPLE_LABELS, type SampleLabel } from "@/lib/sample-labels";
import { OCR_PARAMETERS } from "@/lib/ocr-config";
import { scanBrowserLabel } from "@/lib/scan-label-browser";
import { reviewApplication, type ApplicationImage } from "@/lib/application-review";
import { processApplicationBatch, type ImageTask } from "@/lib/application-processor";
import type { ImageLabel, ValueEvidence } from "@/lib/label-evidence";
import type { ScanPass } from "@/lib/scan-label";
import { EvidenceList, EvidenceViewer } from "./components/application-evidence";

type UploadedImage = ApplicationImage & { file: File; previewUrl: string; progress?: string };
const IMAGE_LABELS: ImageLabel[] = ["", "Front", "Back", "Side", "Wraparound"];
const INPUT_STYLE = "w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-base outline-none focus:border-amber-500 disabled:opacity-50";
const BUTTON_STYLE = "rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";

function validateFile(file: File) {
  if (!["image/png", "image/jpeg", "image/webp", "image/bmp"].includes(file.type)) throw new Error("Use a PNG, JPEG, WebP, or BMP image.");
  if (file.size > 10 * 1024 * 1024) throw new Error("The image exceeds 10 MB. Choose a smaller image.");
}

export default function Home() {
  const [applicationId, setApplicationId] = useState("APP-001");
  const [form, setForm] = useState<ApplicationFields>(SAMPLE_APPLICATION);
  const [isImported, setIsImported] = useState(false);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [overrides, setOverrides] = useState<Partial<ApplicationFields>>({});
  const [correctionSources, setCorrectionSources] = useState<Partial<Record<FieldKey, string>>>({});
  const [warningCorrections, setWarningCorrections] = useState<Record<string, string>>({});
  const [applicationLatencyMs, setApplicationLatencyMs] = useState(0);
  const [lastRunMs, setLastRunMs] = useState<number | null>(null);
  const [appError, setAppError] = useState("");
  const [selectedEvidence, setSelectedEvidence] = useState<ValueEvidence | null>(null);
  const workers = useRef<Array<Worker | null>>([]);
  const contexts = useRef<Array<{ imageId: string; applicationId: string; pass: ScanPass }>>([]);
  const mounted = useRef(true);
  const busy = useRef(false);
  const previewUrls = useRef(new Set<string>());
  const locked = isProcessing || loadingSample;

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

  const review = useMemo(() => reviewApplication(applicationId.trim() || "UNASSIGNED", form, images,
    { isImported, overrides, correctionSources, warningCorrections }),
  [applicationId, form, images, isImported, overrides, correctionSources, warningCorrections]);
  const successful = images.filter((image) => image.status === "success" && image.scan);
  const selectedImage = images.find((image) => image.id === selectedEvidence?.image?.imageId);
  const summary = review.results.reduce((counts, result) => {
    counts[result.status]++;
    return counts;
  }, { match: 0, mismatch: 0, "needs-review": 0 });

  const clearCorrections = () => {
    setOverrides({}); setCorrectionSources({}); setWarningCorrections({}); setShowResults(false); setSelectedEvidence(null);
  };

  const handleProcess = useCallback(async (snapshot: UploadedImage[], targetIds: string[], appId: string) => {
    if (busy.current) return;
    busy.current = true;
    setIsProcessing(true);
    setAppError("");
    setShowResults(false);
    setSelectedEvidence(null);
    const targets = new Set(targetIds);
    setImages(snapshot.map((image) => targets.has(image.id)
      ? { ...image, status: "pending", scan: undefined, error: undefined, progress: "Queued" } : image));
    const tasks: ImageTask<File>[] = snapshot.filter((image) => targets.has(image.id)).map((image) => ({
      id: image.id, applicationId: image.applicationId, name: image.name, label: image.label, input: image.file,
    }));
    try {
      const batch = await processApplicationBatch([{ applicationId: appId, images: tasks }], async (task, slot) => {
        validateFile(task.input);
        contexts.current[slot] = { imageId: task.id, applicationId: task.applicationId, pass: { rotation: 0 } };
        try {
          if (!workers.current[slot]) {
            const worker = await new Promise<Worker>((resolve, reject) => {
              void createWorker("eng", 1, {
                errorHandler: (error: unknown) => reject(new Error(String(error))),
                logger: (message) => {
                  const context = contexts.current[slot];
                  if (!mounted.current || !context || message.status !== "recognizing text") return;
                  const progress = `Reading ${context.pass.region ? "text region" : "image"} at ${context.pass.rotation}°: ${Math.round(message.progress * 100)}%`;
                  setImages((current) => current.map((image) => image.id === context.imageId && image.applicationId === context.applicationId ? { ...image, progress } : image));
                },
              }).then(resolve, reject);
            });
            if (!mounted.current) { await worker.terminate(); throw new Error("Review session closed."); }
            workers.current[slot] = worker;
            await worker.setParameters(OCR_PARAMETERS);
          }
          return await scanBrowserLabel(workers.current[slot]!, task.input, (pass) => {
            contexts.current[slot].pass = pass;
            if (mounted.current) setImages((current) => current.map((image) => image.id === task.id && image.applicationId === task.applicationId
              ? { ...image, progress: pass.region ? `Reading a text region at ${pass.rotation}°` : `Reading image at ${pass.rotation}°` } : image));
          });
        } catch (error) {
          const failed = workers.current[slot];
          workers.current[slot] = null;
          await failed?.terminate().catch(() => {});
          throw error;
        }
      }, { concurrency: 2, onImage: (result) => {
        if (mounted.current) setImages((current) => current.map((image) => image.id === result.id && image.applicationId === result.applicationId
          ? { ...image, ...result, progress: result.status === "processing" ? "Preparing scanner..." : undefined } : image));
      } });
      if (mounted.current) {
        setApplicationLatencyMs((current) => current + batch.applications[0].latencyMs);
        setLastRunMs(batch.applications[0].latencyMs);
      }
    } catch (error) {
      if (mounted.current) setAppError(error instanceof Error ? error.message : String(error));
    } finally {
      busy.current = false;
      if (mounted.current) setIsProcessing(false);
    }
  }, []);

  const createUploaded = (file: File, appId: string, label: ImageLabel = ""): UploadedImage => {
    let previewUrl = "";
    try { validateFile(file); previewUrl = URL.createObjectURL(file); previewUrls.current.add(previewUrl); } catch { /* The queue reports validation errors per image. */ }
    return { id: crypto.randomUUID(), applicationId: appId, name: file.name, file, previewUrl, label, status: "pending" };
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const appId = applicationId.trim();
    if (!files.length || !appId || busy.current) return;
    setShowResults(false);
    setSelectedEvidence(null);
    setApplicationId(appId);
    const added = files.map((file) => createUploaded(file, appId));
    void handleProcess([...images, ...added], added.map((image) => image.id), appId);
  };

  const handleRemove = (id: string) => {
    const image = images.find((item) => item.id === id);
    if (image?.previewUrl) { URL.revokeObjectURL(image.previewUrl); previewUrls.current.delete(image.previewUrl); }
    const remaining = images.filter((item) => item.id !== id);
    setImages(remaining);
    clearCorrections();
    if (!remaining.length) { setApplicationLatencyMs(0); setLastRunMs(null); }
  };

  const handleClear = () => {
    for (const image of images) if (image.previewUrl) { URL.revokeObjectURL(image.previewUrl); previewUrls.current.delete(image.previewUrl); }
    setImages([]); clearCorrections(); setApplicationLatencyMs(0); setLastRunMs(null); setAppError("");
  };

  const handleSample = async (sample: SampleLabel) => {
    if (locked || busy.current) return;
    setLoadingSample(true); setAppError("");
    try {
      const response = await fetch(sample.src);
      if (!response.ok) throw new Error("Could not load the sample image.");
      const blob = await response.blob();
      const file = new File([blob], sample.src.split("/").at(-1)!, { type: blob.type });
      handleClear();
      const appId = `SAMPLE-${sample.id}`;
      setApplicationId(appId); setForm({ ...SAMPLE_APPLICATION }); setIsImported(false);
      const image = createUploaded(file, appId, "Wraparound");
      await handleProcess([image], [image.id], appId);
    } catch (error) { setAppError(error instanceof Error ? error.message : String(error)); }
    finally { setLoadingSample(false); }
  };

  return <main className="min-h-screen bg-slate-100 text-slate-900">
    <div className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-8 rounded-2xl bg-slate-900 p-6 text-white shadow-lg">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-amber-300">TTB Label Compliance Pilot</p>
        <h1 className="mt-2 text-3xl font-bold">Alcohol Label Verification Assistant</h1>
        <p className="mt-3 text-sm text-slate-200">Compare one application with all its label images. Front, back, side, and a single wraparound image are supported.</p>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">Application details</h2>
            <button type="button" disabled={!images.length || locked} onClick={() => setShowResults(true)} className="rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">Run verification</button>
          </div>
          <label className="block text-sm font-medium text-slate-700">Application ID
            <input value={applicationId} disabled={!!images.length || locked} onChange={(event) => setApplicationId(event.target.value)} className={`mt-2 ${INPUT_STYLE}`} />
          </label>
          <p className="mt-2 text-xs text-slate-500">Every image is assigned to this ID. Clear the image set to change applications. One wraparound image is enough; separate front and back images are optional.</p>
          <p className="my-4 text-sm text-slate-600">Enter expected values, add all available label images, then review their combined evidence.</p>
          <label className="mb-5 flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={isImported} onChange={(event) => { setIsImported(event.target.checked); setShowResults(false); }} />Imported product — include country of origin
          </label>
          <div className="space-y-5">
            {(Object.keys(FIELD_LABELS) as FieldKey[]).filter((field) => field !== "countryOfOrigin" || isImported).map((field) => {
              const detected = review.fields[field];
              return <div key={field} className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">{FIELD_LABELS[field]} — application
                  <input value={form[field]} onChange={(event) => { setForm((current) => ({ ...current, [field]: event.target.value })); setShowResults(false); }} className={`mt-2 ${INPUT_STYLE}`} />
                </label>
                <div className="text-sm text-slate-700">
                  <label htmlFor={`detected-${field}`} className="mb-2 block font-medium">Detected across supplied images</label>
                  <input id={`detected-${field}`} value={overrides[field] ?? detected.value} disabled={!successful.length || locked}
                    onChange={(event) => { setOverrides((current) => ({ ...current, [field]: event.target.value })); if (successful.length === 1) setCorrectionSources((current) => ({ ...current, [field]: successful[0].id })); setShowResults(false); }}
                    className={INPUT_STYLE} placeholder={review.complete ? "Not detected in supplied images" : "Awaiting complete image evidence"} />
                  {overrides[field] !== undefined ? <label className="mt-2 block text-xs">Correction source image
                    <select value={correctionSources[field] ?? (successful.length === 1 ? successful[0].id : "")} onChange={(event) => { setCorrectionSources((current) => ({ ...current, [field]: event.target.value })); setShowResults(false); }} className="mt-1 w-full rounded-lg border border-slate-300 p-2">
                      <option value="">Choose a source image</option>{successful.map((image) => <option key={image.id} value={image.id}>{image.name} {image.label ? `(${image.label})` : ""}</option>)}
                    </select>
                  </label> : images.length ? <p className={`mt-1 text-xs ${detected.uncertain ? "text-amber-800" : "text-slate-500"}`}>{detected.confidence != null ? `${Math.round(detected.confidence)}% OCR confidence` : "No reliable reading yet"}{detected.uncertain ? " · needs review" : ""}</p> : null}
                  <EvidenceList observations={detected.observations} onSelect={setSelectedEvidence} />
                </div>
              </div>;
            })}
          </div>
          <p className="mt-4 text-xs text-slate-500">Confidence describes text recognition. Conflicting values stay under review even if a manual correction is entered.</p>
        </section>

        <aside className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-xl font-semibold">Label images</h2>
          <label className={`mt-4 block rounded-xl border-2 border-dashed border-slate-300 p-5 text-center text-sm font-semibold focus-within:ring-2 focus-within:ring-amber-500 ${locked || !applicationId.trim() ? "opacity-50" : "cursor-pointer hover:border-amber-500"}`}>
            {locked ? "Processing images..." : "Add label images"}
            <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/bmp" disabled={locked || !applicationId.trim()} className="sr-only" onChange={handleUpload} />
          </label>
          <p className="mt-2 text-xs text-slate-500">Select one or multiple PNG, JPEG, WebP, or BMP images. Maximum 10 MB each. Added images share application {applicationId.trim() || "ID (required)"}.</p>
          {appError ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{appError}</p> : null}
          {!!images.length && <div role="status" aria-live="polite" className="mt-4 rounded-xl bg-slate-100 p-3 text-sm">
            <p>{successful.length} of {images.length} images processed successfully{isProcessing ? " · processing" : ""}.</p>
            {lastRunMs != null ? <><p>Total application processing time this session: {(applicationLatencyMs / 1000).toFixed(1)}s, including retries.</p><p className="mt-1 text-xs text-slate-500">Latest run: {(lastRunMs / 1000).toFixed(1)}s. Up to 2 images processed at once.</p></> : null}
            {!review.complete && !locked ? <p className="mt-2 font-medium text-amber-800">Evidence is incomplete. Retry failed images or remove them to review the remaining supplied set.</p> : null}
          </div>}
          <div className="mt-4 space-y-4">
            {images.map((image) => <article key={image.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{image.name}</h3><p className="text-xs text-slate-500">Application {image.applicationId}</p></div>
                <button type="button" disabled={locked} onClick={() => handleRemove(image.id)} aria-label={`Remove ${image.name}`} className="text-xs font-medium text-red-700 underline disabled:opacity-40">Remove</button>
              </div>
              {image.previewUrl ? <a href={image.previewUrl} target="_blank" rel="noreferrer"><Image src={image.previewUrl} alt={`Label image ${image.name}`} unoptimized width={800} height={600} className="mt-2 h-44 w-full rounded-lg bg-slate-50 object-contain" /></a> : null}
              <label className="mt-3 block text-xs font-medium">Image label (optional)
                <select value={image.label ?? ""} disabled={locked} onChange={(event) => setImages((current) => current.map((item) => item.id === image.id ? { ...item, label: event.target.value as ImageLabel } : item))} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm">
                  {IMAGE_LABELS.map((label) => <option key={label} value={label}>{label || "Unspecified"}</option>)}
                </select>
              </label>
              <p className="mt-2 text-xs text-slate-600">{image.status === "success" ? `Scan complete · ${((image.durationMs ?? 0) / 1000).toFixed(1)}s` : image.progress ?? image.status}</p>
              {image.status === "error" ? <div role="alert" className="mt-2 text-sm text-red-800"><p>{image.name}: {image.error}</p><button type="button" disabled={locked} className={`mt-2 ${BUTTON_STYLE}`} onClick={() => { setWarningCorrections((current) => { const next = { ...current }; delete next[image.id]; return next; }); void handleProcess(images, [image.id], applicationId.trim()); }}>Retry this image</button></div> : null}
              {image.status === "success" ? <details className="mt-3 text-xs text-slate-600"><summary className="cursor-pointer">Review or correct warning text in this image</summary>
                <p className="mt-2">A warning may appear in any image. A blank reading here does not mean it is absent from the application.</p>
                <textarea aria-label={`Warning text in ${image.name}`} value={warningCorrections[image.id] ?? image.scan?.warning?.text ?? ""} rows={5}
                  onChange={(event) => { setWarningCorrections((current) => ({ ...current, [image.id]: event.target.value })); setShowResults(false); }}
                  className="mt-2 w-full rounded-lg border border-slate-300 p-2 text-sm" />
                {warningCorrections[image.id] !== undefined ? <p>Manually transcribed from this image; no automated confidence score is claimed.</p> : null}
              </details> : null}
            </article>)}
          </div>
          {!!images.length && <button type="button" disabled={locked} onClick={handleClear} className="mt-4 text-sm font-medium text-slate-600 underline disabled:opacity-40">Clear images / change application</button>}
          <div className="mt-6 border-t border-slate-200 pt-4"><h3 className="font-semibold">Try a sample application</h3><p className="mt-1 text-xs text-slate-500">Replaces the current image set and fills the Old Tom expected values. Each sample is one complete wraparound label.</p>
            <div className="mt-3 space-y-2">{SAMPLE_LABELS.map((sample) => <button key={sample.id} type="button" disabled={locked} onClick={() => void handleSample(sample)} className="block w-full rounded-lg border border-slate-300 p-3 text-left disabled:opacity-40"><span className="block text-sm font-semibold">{sample.name}</span><span className="block text-xs text-slate-500">{sample.description}</span></button>)}</div>
          </div>
        </aside>
      </div>

      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-xl font-semibold">Application review</h2>
        {images.length ? <p className="mt-2 text-sm text-slate-600">Application {applicationId} · warning presence: {review.warningPresence === "found" ? "found in supplied evidence" : review.warningPresence === "not-detected" ? "not detected in supplied images" : "awaiting complete image evidence"}.</p> : null}
        {showResults ? <div className="mt-4 space-y-3">
          {!review.complete ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900">Incomplete evidence: every finding needs review. No overall pass or definitive missing-field conclusion is available.</p> : null}
          <div className="grid grid-cols-3 gap-2 text-center text-sm">{(["match", "mismatch", "needs-review"] as const).map((status) => <div key={status} className={`rounded-xl p-3 ${status === "match" ? "bg-emerald-100 text-emerald-900" : status === "mismatch" ? "bg-red-100 text-red-900" : "bg-amber-100 text-amber-900"}`}><p className="text-lg font-bold">{summary[status]}</p>{status === "needs-review" ? "Needs review" : status === "match" ? "Match" : "Mismatch"}</div>)}</div>
          {review.results.map((result) => <article key={result.field} className={`rounded-xl border p-4 ${result.status === "match" ? "border-emerald-200 bg-emerald-50" : result.status === "mismatch" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex items-center justify-between gap-4"><h3 className="font-semibold">{result.field}</h3><span className="text-xs font-semibold uppercase">{result.status === "needs-review" ? "Needs review" : result.status}</span></div>
            <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2"><div><dt className="font-medium">{result.field === "Government Warning" ? "Required text" : "Application value"}</dt><dd className="break-words">{result.expected || "Not provided"}</dd></div>
              <div><dt className="font-medium">Label value(s)</dt><dd className="whitespace-pre-wrap break-words">{result.extracted || (result.detection === "not-detected" ? "Not detected in supplied images" : "No reliable value available")}</dd></div></dl>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{result.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
            <EvidenceList observations={result.observations} onSelect={setSelectedEvidence} />
          </article>)}
        </div> : <p className="mt-4 text-sm text-slate-500">{locked ? "Processing image evidence. Verification will be available when this run finishes." : "Add all available images and select Run verification. You can inspect partial evidence after a processing failure."}</p>}
      </section>

      {!!successful.length && <details className="mt-6 rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200"><summary className="cursor-pointer font-semibold text-slate-800">Scan diagnostics — raw OCR by image</summary>
        {successful.map((image) => <div key={image.id} className="mt-4 border-t border-slate-200 pt-3"><h3 className="font-semibold">{image.name} · application {image.applicationId}</h3>{image.scan!.pages.map((page, index) => <div key={index} className="mt-2"><p>{page.region ? "Text region" : "Full image"} at {page.rotation}° · {Math.round(page.confidence)}% OCR confidence</p><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{page.text}</pre></div>)}</div>)}
      </details>}
      {selectedEvidence && selectedImage?.previewUrl ? <EvidenceViewer evidence={selectedEvidence} imageUrl={selectedImage.previewUrl} onClose={() => setSelectedEvidence(null)} /> : null}
    </div>
  </main>;
}
