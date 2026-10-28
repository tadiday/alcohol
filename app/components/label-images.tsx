import Image from "next/image";
import { MAX_OCR_CONCURRENCY } from "@/lib/application-processor";
import type { ImageLabel } from "@/lib/label-evidence";
import { SAMPLE_LABELS, type SampleLabel } from "@/lib/sample-labels";
import type { UploadedImage } from "../hooks/use-label-images";

const IMAGE_LABELS: ImageLabel[] = ["", "Front", "Back", "Side", "Wraparound"];
const BUTTON_STYLE = "rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";

type LabelImagesProps = {
  applicationId: string;
  images: UploadedImage[];
  successfulCount: number;
  locked: boolean;
  isProcessing: boolean;
  complete: boolean;
  error: string;
  applicationLatencyMs: number;
  lastRunMs: number | null;
  warningCorrections: Record<string, string>;
  onUpload: (files: File[]) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onLabelChange: (id: string, label: ImageLabel) => void;
  onWarningChange: (id: string, value: string) => void;
  onClear: () => void;
  onSample: (sample: SampleLabel) => void;
};

type LabelImageCardProps = Pick<LabelImagesProps,
  "locked" | "onRemove" | "onRetry" | "onLabelChange" | "onWarningChange"
> & { image: UploadedImage; warningCorrection?: string };

function LabelImageCard({ image, locked, warningCorrection, onRemove, onRetry, onLabelChange, onWarningChange }: LabelImageCardProps) {
  return (
    <article className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold">{image.name}</h3>
          <p className="text-xs text-slate-500">Application {image.applicationId}</p>
        </div>
        <button type="button" disabled={locked} onClick={() => onRemove(image.id)} aria-label={`Remove ${image.name}`}
          className="text-xs font-medium text-red-700 underline disabled:opacity-40">
          Remove
        </button>
      </div>
      {image.previewUrl ? (
        <a href={image.previewUrl} target="_blank" rel="noreferrer">
          <Image src={image.previewUrl} alt={`Label image ${image.name}`} unoptimized width={800} height={600}
            className="mt-2 h-44 w-full rounded-lg bg-slate-50 object-contain" />
        </a>
      ) : null}
      <label className="mt-3 block text-xs font-medium">
        Image label (optional)
        <select value={image.label ?? ""} disabled={locked}
          onChange={(event) => onLabelChange(image.id, event.target.value as ImageLabel)}
          className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm">
          {IMAGE_LABELS.map((label) => <option key={label} value={label}>{label || "Unspecified"}</option>)}
        </select>
      </label>
      <p className="mt-2 text-xs text-slate-600">
        {image.status === "success" ? `Scan complete · ${((image.durationMs ?? 0) / 1000).toFixed(1)}s` : image.progress ?? image.status}
      </p>
      {image.status === "error" ? (
        <div role="alert" className="mt-2 text-sm text-red-800">
          <p>{image.name}: {image.error}</p>
          <button type="button" disabled={locked} className={`mt-2 ${BUTTON_STYLE}`} onClick={() => onRetry(image.id)}>
            Retry this image
          </button>
        </div>
      ) : null}
      {image.status === "success" ? (
        <details className="mt-3 text-xs text-slate-600">
          <summary className="cursor-pointer">Review or correct warning text in this image</summary>
          <p className="mt-2">A warning may appear in any image. A blank reading here does not mean it is absent from the application.</p>
          <textarea aria-label={`Warning text in ${image.name}`} value={warningCorrection ?? image.scan?.warning?.text ?? ""}
            rows={5} onChange={(event) => onWarningChange(image.id, event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 p-2 text-sm" />
          {warningCorrection !== undefined ? <p>Manually transcribed from this image; no automated confidence score is claimed.</p> : null}
        </details>
      ) : null}
    </article>
  );
}

export function LabelImages({
  applicationId, images, successfulCount, locked, isProcessing, complete, error,
  applicationLatencyMs, lastRunMs, warningCorrections, onUpload, onRemove, onRetry,
  onLabelChange, onWarningChange, onClear, onSample,
}: LabelImagesProps) {
  const uploadDisabled = locked || !applicationId.trim();

  return (
    <aside className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-xl font-semibold">Label images</h2>
      <label className={`mt-4 block rounded-xl border-2 border-dashed border-slate-300 p-5 text-center text-sm font-semibold focus-within:ring-2 focus-within:ring-amber-500 ${uploadDisabled ? "opacity-50" : "cursor-pointer hover:border-amber-500"}`}>
        {locked ? "Processing images..." : "Add label images"}
        <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/bmp" disabled={uploadDisabled}
          className="sr-only" onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            onUpload(files);
          }} />
      </label>
      <p className="mt-2 text-xs text-slate-500">Select one or multiple PNG, JPEG, WebP, or BMP images. Maximum 10 MB each. Added images share application {applicationId.trim() || "ID (required)"}.</p>
      {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {!!images.length && (
        <div role="status" aria-live="polite" className="mt-4 rounded-xl bg-slate-100 p-3 text-sm">
          <p>{successfulCount} of {images.length} images processed successfully{isProcessing ? " · processing" : ""}.</p>
          {lastRunMs != null ? (
            <>
              <p>Total application processing time this session: {(applicationLatencyMs / 1000).toFixed(1)}s, including retries.</p>
              <p className="mt-1 text-xs text-slate-500">Latest run: {(lastRunMs / 1000).toFixed(1)}s. Up to {MAX_OCR_CONCURRENCY} images processed at once.</p>
            </>
          ) : null}
          {!complete && !locked ? <p className="mt-2 font-medium text-amber-800">Evidence is incomplete. Retry failed images or remove them to review the remaining supplied set.</p> : null}
        </div>
      )}
      <div className="mt-4 space-y-4">
        {images.map((image) => (
          <LabelImageCard key={image.id} image={image} locked={locked} warningCorrection={warningCorrections[image.id]}
            onRemove={onRemove} onRetry={onRetry} onLabelChange={onLabelChange} onWarningChange={onWarningChange} />
        ))}
      </div>
      {!!images.length && (
        <button type="button" disabled={locked} onClick={onClear} className="mt-4 text-sm font-medium text-slate-600 underline disabled:opacity-40">
          Clear images / change application
        </button>
      )}
      <div className="mt-6 border-t border-slate-200 pt-4">
        <h3 className="font-semibold">Try a sample application</h3>
        <p className="mt-1 text-xs text-slate-500">Replaces the current image set and fills the Old Tom expected values. Each sample is one complete wraparound label.</p>
        <div className="mt-3 space-y-2">
          {SAMPLE_LABELS.map((sample) => (
            <button key={sample.id} type="button" disabled={locked} onClick={() => onSample(sample)}
              className="block w-full rounded-lg border border-slate-300 p-3 text-left disabled:opacity-40">
              <span className="block text-sm font-semibold">{sample.name}</span>
              <span className="block text-xs text-slate-500">{sample.description}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
