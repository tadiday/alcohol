import type { ApplicationReview, ProcessedApplicationImage } from "@/lib/application/application-review";
import type { ValueEvidence } from "@/lib/label-evidence";
import type { ComparisonStatus } from "@/lib/verification/label-verifier";
import { EvidenceList } from "./application-evidence";

const STATUS_PRESENTATION = {
  match: { label: "Match", summary: "bg-emerald-100 text-emerald-900", finding: "border-emerald-200 bg-emerald-50" },
  mismatch: { label: "Mismatch", summary: "bg-red-100 text-red-900", finding: "border-red-200 bg-red-50" },
  "needs-review": { label: "Needs review", summary: "bg-amber-100 text-amber-900", finding: "border-amber-200 bg-amber-50" },
} satisfies Record<ComparisonStatus, { label: string; summary: string; finding: string }>;

const WARNING_PRESENCE = {
  found: "found in supplied evidence",
  "not-detected": "not detected in supplied images",
  unavailable: "awaiting complete image evidence",
} satisfies Record<ApplicationReview["warningPresence"], string>;

export function ApplicationResults({ applicationId, review, visible, locked, onSelectEvidence }: {
  applicationId: string;
  review: ApplicationReview;
  visible: boolean;
  locked: boolean;
  onSelectEvidence: (evidence: ValueEvidence) => void;
}) {
  const counts = review.results.reduce((counts, result) => {
    counts[result.status]++;
    return counts;
  }, { match: 0, mismatch: 0, "needs-review": 0 });

  return (
    <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-xl font-semibold">Application review</h2>
      {review.totalImages > 0 ? (
        <p className="mt-2 text-sm text-slate-600">Application {applicationId} · warning presence: {WARNING_PRESENCE[review.warningPresence]}.</p>
      ) : null}
      {visible ? (
        <div className="mt-4 space-y-3">
          {!review.complete ? (
            <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900">
              Incomplete evidence: every finding needs review. No overall pass or definitive missing-field conclusion is available.
            </p>
          ) : null}
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            {(Object.keys(STATUS_PRESENTATION) as ComparisonStatus[]).map((status) => (
              <div key={status} className={`rounded-xl p-3 ${STATUS_PRESENTATION[status].summary}`}>
                <p className="text-lg font-bold">{counts[status]}</p>
                {STATUS_PRESENTATION[status].label}
              </div>
            ))}
          </div>
          {review.results.map((result) => (
            <article key={result.field} className={`rounded-xl border p-4 ${STATUS_PRESENTATION[result.status].finding}`}>
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-semibold">{result.field}</h3>
                <span className="text-xs font-semibold uppercase">{STATUS_PRESENTATION[result.status].label}</span>
              </div>
              <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="font-medium">{result.field === "Government Warning" ? "Required text" : "Application value"}</dt>
                  <dd className="break-words">{result.expected || "Not provided"}</dd>
                </div>
                <div>
                  <dt className="font-medium">Label value(s)</dt>
                  <dd className="whitespace-pre-wrap break-words">
                    {result.extracted || (result.detection === "not-detected" ? "Not detected in supplied images" : "No reliable value available")}
                  </dd>
                </div>
              </dl>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {result.notes.map((note, index) => <li key={index}>{note}</li>)}
              </ul>
              <EvidenceList observations={result.observations} onSelect={onSelectEvidence} />
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">
          {locked ? "Processing image evidence. Verification will be available when this run finishes."
            : "Add all available images and select Run verification. You can inspect partial evidence after a processing failure."}
        </p>
      )}
    </section>
  );
}

export function ScanDiagnostics({ images }: { images: ProcessedApplicationImage[] }) {
  if (!images.length) return null;

  return (
    <details className="mt-6 rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
      <summary className="cursor-pointer font-semibold text-slate-800">Scan diagnostics — raw OCR by image</summary>
      {images.map((image) => (
        <div key={image.id} className="mt-4 border-t border-slate-200 pt-3">
          <h3 className="font-semibold">{image.name} · application {image.applicationId}</h3>
          {image.scan.pages.map((page, index) => (
            <div key={index} className="mt-2">
              <p>{page.region ? "Text region" : "Full image"} at {page.rotation}° · {Math.round(page.confidence)}% OCR confidence</p>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{page.text}</pre>
            </div>
          ))}
        </div>
      ))}
    </details>
  );
}
