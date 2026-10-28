"use client";

import { useMemo, useState } from "react";
import { reviewApplication } from "@/lib/application/application-review";
import type { ValueEvidence } from "@/lib/label-evidence";
import type { ApplicationFields, FieldKey } from "@/lib/verification/label-verifier";
import { SAMPLE_APPLICATION, type SampleLabel } from "@/lib/sample-labels";
import { ApplicationForm } from "./components/application-form";
import { EvidenceViewer } from "./components/application-evidence";
import { ApplicationResults, ScanDiagnostics } from "./components/application-results";
import { LabelImages } from "./components/label-images";
import { useLabelImages, type UploadedImage } from "./hooks/use-label-images";

export default function Home() {
  const [applicationId, setApplicationId] = useState("APP-001");
  const [expected, setExpected] = useState<ApplicationFields>(SAMPLE_APPLICATION);
  const [isImported, setIsImported] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [overrides, setOverrides] = useState<Partial<ApplicationFields>>({});
  const [correctionSources, setCorrectionSources] = useState<Partial<Record<FieldKey, string>>>({});
  const [warningCorrections, setWarningCorrections] = useState<Record<string, string>>({});
  const [selectedEvidence, setSelectedEvidence] = useState<ValueEvidence | null>(null);
  const scanner = useLabelImages();
  const { images, successfulImages, isProcessing } = scanner;
  const locked = isProcessing || loadingSample;

  const review = useMemo(() => reviewApplication(applicationId.trim() || "UNASSIGNED", expected, images, {
    isImported, overrides, correctionSources, warningCorrections,
  }), [applicationId, expected, images, isImported, overrides, correctionSources, warningCorrections]);
  const selectedImage = images.find((image) => image.id === selectedEvidence?.image?.imageId);

  function clearCorrections() {
    setOverrides({});
    setCorrectionSources({});
    setWarningCorrections({});
    setShowResults(false);
    setSelectedEvidence(null);
  }

  function processImages(snapshot: UploadedImage[], targetIds: string[], appId: string) {
    setShowResults(false);
    setSelectedEvidence(null);
    return scanner.processImages(snapshot, targetIds, appId);
  }

  function handleUpload(files: File[]) {
    const appId = applicationId.trim();
    if (!files.length || !appId || locked || scanner.isBusy()) return;
    setApplicationId(appId);
    const added = files.map((file) => scanner.createImage(file, appId));
    void processImages([...images, ...added], added.map((image) => image.id), appId);
  }

  function handleRemove(id: string) {
    scanner.removeImage(id);
    clearCorrections();
  }

  function handleClear() {
    scanner.clearImages();
    clearCorrections();
  }

  function handleRetry(id: string) {
    setWarningCorrections((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    void processImages(images, [id], applicationId.trim());
  }

  async function handleSample(sample: SampleLabel) {
    if (locked || scanner.isBusy()) return;
    setLoadingSample(true);
    scanner.setError("");

    try {
      const response = await fetch(sample.src);
      if (!response.ok) throw new Error("Could not load the sample image.");
      const blob = await response.blob();
      const file = new File([blob], sample.src.split("/").at(-1)!, { type: blob.type });
      handleClear();
      const appId = `SAMPLE-${sample.id}`;
      setApplicationId(appId);
      setExpected({ ...SAMPLE_APPLICATION });
      setIsImported(false);
      const image = scanner.createImage(file, appId, "Wraparound");
      await processImages([image], [image.id], appId);
    } catch (error) {
      scanner.setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingSample(false);
    }
  }

  function handleExpectedChange(field: FieldKey, value: string) {
    setExpected((current) => ({ ...current, [field]: value }));
    setShowResults(false);
  }

  function handleDetectedChange(field: FieldKey, value: string) {
    setOverrides((current) => ({ ...current, [field]: value }));
    if (successfulImages.length === 1) {
      setCorrectionSources((current) => ({ ...current, [field]: successfulImages[0].id }));
    }
    setShowResults(false);
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <header className="mb-8 rounded-2xl bg-slate-900 p-6 text-white shadow-lg">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-amber-300">TTB Label Compliance Pilot</p>
          <h1 className="mt-2 text-3xl font-bold">Alcohol Label Verification Assistant</h1>
          <p className="mt-3 text-sm text-slate-200">Compare one application with all its label images. Front, back, side, and a single wraparound image are supported.</p>
        </header>

        <div className="grid items-start gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <ApplicationForm
            applicationId={applicationId} expected={expected} isImported={isImported}
            hasImages={images.length > 0} locked={locked} review={review} successfulImages={successfulImages}
            overrides={overrides} correctionSources={correctionSources}
            onApplicationIdChange={setApplicationId} onExpectedChange={handleExpectedChange}
            onDetectedChange={handleDetectedChange} onSelectEvidence={setSelectedEvidence}
            onVerify={() => setShowResults(true)}
            onImportedChange={(value) => {
              setIsImported(value);
              setShowResults(false);
            }}
            onCorrectionSourceChange={(field, imageId) => {
              setCorrectionSources((current) => ({ ...current, [field]: imageId }));
              setShowResults(false);
            }}
          />
          <LabelImages
            applicationId={applicationId} images={images} successfulCount={successfulImages.length}
            locked={locked} isProcessing={isProcessing} complete={review.complete} error={scanner.error}
            applicationLatencyMs={scanner.applicationLatencyMs} lastRunMs={scanner.lastRunMs}
            warningCorrections={warningCorrections} onUpload={handleUpload} onRemove={handleRemove}
            onRetry={handleRetry} onLabelChange={scanner.setImageLabel} onClear={handleClear}
            onSample={(sample) => void handleSample(sample)}
            onWarningChange={(id, value) => {
              setWarningCorrections((current) => ({ ...current, [id]: value }));
              setShowResults(false);
            }}
          />
        </div>

        <ApplicationResults applicationId={applicationId} review={review} visible={showResults}
          locked={locked} onSelectEvidence={setSelectedEvidence} />
        <ScanDiagnostics images={successfulImages} />
        {selectedEvidence && selectedImage?.previewUrl ? (
          <EvidenceViewer evidence={selectedEvidence} imageUrl={selectedImage.previewUrl} onClose={() => setSelectedEvidence(null)} />
        ) : null}
      </div>
    </main>
  );
}
