"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IngestDropzone, type IngestSource } from "@/components/ingestion/IngestDropzone";
import { IngestionProgress, type IngestionStep } from "@/components/ingestion/IngestionProgress";

export default function IngestPage() {
  const router = useRouter();
  const [step, setStep] = useState<IngestionStep>("idle");
  const [error, setError] = useState<string | undefined>();

  async function handleIngest(source: IngestSource) {
    setStep("uploading");
    setError(undefined);

    let body: BodyInit;
    let contentType: string | undefined;

    if (source.type === "file") {
      const form = new FormData();
      form.append("file", source.file);
      body = form;
    } else {
      body = JSON.stringify({ url: source.url });
      contentType = "application/json";
    }

    // Simulate visible progress phases — the whole pipeline runs inside one request
    const t1 = setTimeout(() => setStep("extracting"), 800);
    const t2 = setTimeout(() => setStep("generating"), 3000);

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: contentType ? { "Content-Type": contentType } : {},
        body,
      });

      clearTimeout(t1);
      clearTimeout(t2);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Server error ${res.status}`);
      }

      const data = await res.json();

      // Hand the generated HTML off to the note editor via sessionStorage
      if (data.html && data.note_id) {
        sessionStorage.setItem(`ingest-pending-${data.note_id}`, data.html);
      }

      setStep("done");

      if (data.note_id) {
        router.push(`/brain/${data.note_id}`);
      } else {
        router.push("/brain");
      }
    } catch (e) {
      clearTimeout(t1);
      clearTimeout(t2);
      setStep("error");
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-start pt-16 px-8">
      <div className="w-full max-w-lg">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Import Knowledge</h1>
          <p className="mt-1 text-sm text-gray-500">
            Upload a PDF or paste a URL. Gemini will generate a structured mastery
            guide and load it directly into your editor.
          </p>
        </div>

        <IngestDropzone onSubmit={handleIngest} disabled={step !== "idle" && step !== "error"} />
        <IngestionProgress step={step} error={error} />

        {step === "error" && (
          <button
            onClick={() => setStep("idle")}
            className="mt-3 text-sm text-brand hover:underline"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
