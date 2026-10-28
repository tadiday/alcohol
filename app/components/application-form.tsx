import { FIELD_LABELS, type ApplicationFields, type FieldKey } from "@/lib/verification/label-verifier";
import type { ApplicationImage, ApplicationReview } from "@/lib/application/application-review";
import type { ValueEvidence } from "@/lib/label-evidence";
import { EvidenceList } from "./application-evidence";

const INPUT_STYLE = "w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-base outline-none focus:border-amber-500 disabled:opacity-50";

type ApplicationFormProps = {
  applicationId: string;
  expected: ApplicationFields;
  isImported: boolean;
  hasImages: boolean;
  locked: boolean;
  review: ApplicationReview;
  successfulImages: ApplicationImage[];
  overrides: Partial<ApplicationFields>;
  correctionSources: Partial<Record<FieldKey, string>>;
  onApplicationIdChange: (value: string) => void;
  onImportedChange: (value: boolean) => void;
  onExpectedChange: (field: FieldKey, value: string) => void;
  onDetectedChange: (field: FieldKey, value: string) => void;
  onCorrectionSourceChange: (field: FieldKey, imageId: string) => void;
  onVerify: () => void;
  onSelectEvidence: (evidence: ValueEvidence) => void;
};

/** Keep expected values separate from detected evidence and source-linked corrections. */
export function ApplicationForm({
  applicationId, expected, isImported, hasImages, locked, review, successfulImages,
  overrides, correctionSources, onApplicationIdChange, onImportedChange, onExpectedChange,
  onDetectedChange, onCorrectionSourceChange, onVerify, onSelectEvidence,
}: ApplicationFormProps) {
  const visibleFields = (Object.keys(FIELD_LABELS) as FieldKey[])
    .filter((field) => field !== "countryOfOrigin" || isImported);

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">Application details</h2>
        <button type="button" disabled={!hasImages || locked} onClick={onVerify}
          className="rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
          Run verification
        </button>
      </div>
      <label className="block text-sm font-medium text-slate-700">
        Application ID
        <input value={applicationId} disabled={hasImages || locked}
          onChange={(event) => onApplicationIdChange(event.target.value)} className={`mt-2 ${INPUT_STYLE}`} />
      </label>
      <p className="mt-2 text-xs text-slate-500">Every image is assigned to this ID. Clear the image set to change applications. One wraparound image is enough; separate front and back images are optional.</p>
      <p className="my-4 text-sm text-slate-600">Enter expected values, add all available label images, then review their combined evidence.</p>
      <label className="mb-5 flex items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" checked={isImported} onChange={(event) => onImportedChange(event.target.checked)} />
        Imported product — include country of origin
      </label>
      <div className="space-y-5">
        {visibleFields.map((field) => {
          const detected = review.fields[field];
          const correctionSource = correctionSources[field]
            ?? (successfulImages.length === 1 ? successfulImages[0].id : "");

          return (
            <div key={field} className="grid gap-3 md:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">
                {FIELD_LABELS[field]} — application
                <input value={expected[field]} onChange={(event) => onExpectedChange(field, event.target.value)}
                  className={`mt-2 ${INPUT_STYLE}`} />
              </label>
              <div className="text-sm text-slate-700">
                <label htmlFor={`detected-${field}`} className="mb-2 block font-medium">Detected across supplied images</label>
                <input id={`detected-${field}`} value={overrides[field] ?? detected.value}
                  disabled={!successfulImages.length || locked}
                  onChange={(event) => onDetectedChange(field, event.target.value)} className={INPUT_STYLE}
                  placeholder={review.complete ? "Not detected in supplied images" : "Awaiting complete image evidence"} />
                {overrides[field] !== undefined ? (
                  <label className="mt-2 block text-xs">
                    Correction source image
                    <select value={correctionSource} onChange={(event) => onCorrectionSourceChange(field, event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 p-2">
                      <option value="">Choose a source image</option>
                      {successfulImages.map((image) => (
                        <option key={image.id} value={image.id}>{image.name} {image.label ? `(${image.label})` : ""}</option>
                      ))}
                    </select>
                  </label>
                ) : hasImages ? (
                  <p className={`mt-1 text-xs ${detected.uncertain ? "text-amber-800" : "text-slate-500"}`}>
                    {detected.confidence != null ? `${Math.round(detected.confidence)}% OCR confidence` : "No reliable reading yet"}
                    {detected.uncertain ? " · needs review" : ""}
                  </p>
                ) : null}
                <EvidenceList observations={detected.observations} onSelect={onSelectEvidence} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-slate-500">Confidence describes text recognition. Conflicting values stay under review even if a manual correction is entered.</p>
    </section>
  );
}
