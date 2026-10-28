"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import type { ValueEvidence } from "@/lib/label-evidence";

export function EvidenceList({ observations, onSelect }: {
  observations?: ValueEvidence[];
  onSelect: (evidence: ValueEvidence) => void;
}) {
  if (!observations?.length) return null;
  return <details className="mt-2 text-xs text-slate-600">
    <summary className="cursor-pointer font-medium">View image evidence ({observations.length})</summary>
    <ul className="mt-2 space-y-3">
      {observations.map((entry, index) => <li key={index} className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="font-semibold text-slate-800">{entry.value}</p>
        <button type="button" onClick={() => onSelect(entry)} className="mt-1 text-left font-medium text-blue-700 underline underline-offset-2">
          {entry.image?.imageName ?? "Source image"}{entry.image?.imageLabel ? ` · ${entry.image.imageLabel}` : ""}
        </button>
        <p>Application {entry.image?.applicationId ?? "—"} · {entry.confidence == null ? "Manual transcription" : `${Math.round(entry.confidence)}% OCR confidence`}</p>
        {entry.bbox ? <p>Original image box: ({Math.round(entry.bbox.x0)}, {Math.round(entry.bbox.y0)})–({Math.round(entry.bbox.x1)}, {Math.round(entry.bbox.y1)})</p> : null}
        <pre className="mt-1 whitespace-pre-wrap break-words font-sans">{entry.text}</pre>
      </li>)}
    </ul>
  </details>;
}

/**
 * Show the original source image, scaling its evidence box with the displayed image.
 * Manual evidence without a box still opens its source without inventing a location.
 */
export function EvidenceViewer({ evidence, imageUrl, onClose }: {
  evidence: ValueEvidence;
  imageUrl: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  const width = evidence.image?.width;
  const height = evidence.image?.height;
  const box = evidence.bbox;
  return <dialog ref={dialogRef} onCancel={onClose} className="m-auto max-h-[90vh] w-[min(95vw,1100px)] overflow-auto rounded-2xl bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-950/70">
    <div className="mb-3 flex items-start justify-between gap-4">
      <div><h2 className="font-semibold">{evidence.image?.imageName ?? "Label evidence"}</h2>
        <p className="text-sm text-slate-600">Application {evidence.image?.applicationId} · {evidence.image?.imageLabel || "Unspecified view"}</p>
        <p className="mt-1 break-words text-sm">{evidence.value}</p>
      </div>
      <button type="button" onClick={onClose} autoFocus className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">Close</button>
    </div>
    <div className="relative">
      <Image src={imageUrl} alt={`Source label: ${evidence.image?.imageName ?? "uploaded image"}`} unoptimized width={width ?? 800} height={height ?? 600} className="block h-auto w-full" />
      {box && width && height ? <div aria-label="Highlighted source text" className="pointer-events-none absolute border-4 border-amber-500 bg-amber-300/20" style={{
        left: `${box.x0 / width * 100}%`, top: `${box.y0 / height * 100}%`,
        width: `${(box.x1 - box.x0) / width * 100}%`, height: `${(box.y1 - box.y0) / height * 100}%`,
      }} /> : null}
    </div>
    <p className="mt-2 text-xs text-slate-600">{box ? "The highlighted box identifies the supporting text on the original image." : "No automatic bounding box is available for this evidence."}</p>
  </dialog>;
}
