"use client";

export type IngestionStep =
  | "idle"
  | "uploading"
  | "extracting"
  | "generating"
  | "streaming"
  | "done"
  | "error";

interface IngestionProgressProps {
  step: IngestionStep;
  error?: string;
}

const STEPS: { key: IngestionStep; label: string }[] = [
  { key: "uploading",   label: "Uploading" },
  { key: "extracting",  label: "Extracting" },
  { key: "generating",  label: "Generating" },
  { key: "streaming",   label: "Streaming" },
  { key: "done",        label: "Done" },
];

const ORDER: IngestionStep[] = ["uploading", "extracting", "generating", "streaming", "done"];

export function IngestionProgress({ step, error }: IngestionProgressProps) {
  if (step === "idle") return null;

  const currentIdx = ORDER.indexOf(step);

  return (
    <div className="mt-4">
      {step === "error" ? (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
          {error ?? "Something went wrong. Please try again."}
        </p>
      ) : (
        <div className="flex items-center gap-2">
          {STEPS.map(({ key, label }, i) => {
            const done = i < currentIdx || step === "done";
            const active = key === step;
            return (
              <div key={key} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
                  done    ? "bg-green-100 text-green-700" :
                  active  ? "bg-brand-100 text-brand animate-pulse" :
                            "bg-gray-100 text-gray-400"
                }`}>
                  {done ? "✓" : active ? "●" : "○"} {label}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-px w-4 ${i < currentIdx ? "bg-green-400" : "bg-gray-200"}`} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
