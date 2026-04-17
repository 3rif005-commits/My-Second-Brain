"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IngestDropzone, type IngestSource } from "@/components/ingestion/IngestDropzone";
import { IngestionProgress, type IngestionStep } from "@/components/ingestion/IngestionProgress";

const MODELS = [
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    label: "Nemotron 120B",
    badge: "Fast · Recommended",
    badgeColor: "bg-green-100 text-green-700",
    desc: "NVIDIA 120B — faster, smarter, better structured output than Gemma",
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    label: "Gemma 4 26B",
    badge: "Fallback",
    badgeColor: "bg-gray-100 text-gray-500",
    desc: "Google Gemma 4 MoE — reliable fallback if Nemotron is unavailable",
  },
] as const;

type ModelId = typeof MODELS[number]["id"];

export default function IngestPage() {
  const router = useRouter();
  const [step, setStep] = useState<IngestionStep>("idle");
  const [error, setError] = useState<string | undefined>();
  const [model, setModel] = useState<ModelId>("nvidia/nemotron-3-super-120b-a12b:free");

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
        headers: {
          ...(contentType ? { "Content-Type": contentType } : {}),
          "X-LLM-Model": model,
        },
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
            Upload a PDF or paste a URL and the AI will generate a structured
            mastery guide directly into your editor.
          </p>
        </div>

        {/* Model selector */}
        <div className="mb-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">AI Model</p>
          <div className="grid grid-cols-2 gap-2">
            {MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                disabled={step !== "idle" && step !== "error"}
                className={`text-left px-3 py-2.5 rounded-lg border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                  model === m.id
                    ? "border-brand bg-brand-50"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-gray-800">{m.label}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${m.badgeColor}`}>
                    {m.badge}
                  </span>
                </div>
                <p className="text-xs text-gray-400 leading-tight">{m.desc}</p>
              </button>
            ))}
          </div>
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
