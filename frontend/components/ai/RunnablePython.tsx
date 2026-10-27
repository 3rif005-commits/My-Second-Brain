"use client";

// A Python code block in a chat answer, with Run. The code runs only when you
// click, in the browser sandbox (lib/sandbox/python.ts): no network, no access
// to your notes or account, killed after a time limit. It never runs on the
// server. Output and charts appear under the block.
import { useRef, useState, type ReactNode } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { runPython, type Phase, type PythonRun } from "@/lib/sandbox/python";

/** Text of a highlighted code element (rehype-prism wraps it in spans). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function hastText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return String(node.value ?? "");
  return Array.isArray(node.children) ? node.children.map(hastText).join("") : "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function codeChild(node: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return node?.children?.find((c: any) => c.type === "element" && c.tagName === "code");
}

/** Is this <pre> a Python block? */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isPython(node: any): boolean {
  const cls = codeChild(node)?.properties?.className;
  const list: string[] = Array.isArray(cls) ? cls.map(String) : typeof cls === "string" ? cls.split(" ") : [];
  return list.some((c) => c === "language-python" || c === "language-py");
}

const PRE = "my-3 p-3 rounded-lg bg-gray-900 text-gray-100 text-[13px] overflow-x-auto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function RunnablePre({ node, children }: { node?: any; children?: ReactNode }) {
  if (!isPython(node)) return <pre className={PRE}>{children}</pre>;
  return <RunnablePython code={hastText(codeChild(node)).replace(/\n$/, "")}>{children}</RunnablePython>;
}

export function RunnablePython({ code, children }: { code: string; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase | null>(null);
  const [run, setRun] = useState<PythonRun | null>(null);
  const stop = useRef<AbortController | null>(null);

  async function start() {
    stop.current = new AbortController();
    setRun(null);
    const r = await runPython(code, { onPhase: setPhase, signal: stop.current.signal });
    setPhase(null);
    setRun(r);
  }

  return (
    <div className="my-3">
      <div className="relative">
        <pre className={`${PRE} !my-0`}>{children}</pre>
        <div className="absolute right-2 top-2 flex items-center gap-1">
          {phase ? (
            <button type="button" onClick={() => stop.current?.abort()} aria-label="Stop"
              className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11.5px] bg-white/10 text-gray-100 hover:bg-white/20">
              <Square size={10} /> Stop
            </button>
          ) : (
            <button type="button" onClick={start}
              title="Runs in a sandbox in your browser: no internet, no access to your notes"
              className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11.5px] bg-white/10 text-gray-100 hover:bg-white/20">
              <Play size={10} /> Run
            </button>
          )}
        </div>
      </div>
      {phase && (
        <p role="status" className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] text-ink-tertiary">
          <Loader2 size={11} className="animate-spin" />
          {phase === "loading" ? "Loading Python (the first time takes a moment)…" : "Running…"}
        </p>
      )}
      {run && (
        <div aria-label="Output" className="mt-1.5 rounded-lg border border-line p-2.5 text-[12.5px]">
          {run.stdout && <pre className="whitespace-pre-wrap font-mono text-ink">{run.stdout}</pre>}
          {run.result && <pre className="whitespace-pre-wrap font-mono text-ink-secondary">{run.result}</pre>}
          {run.images.map((b64, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={`data:image/png;base64,${b64}`} alt={`Chart ${i + 1}`} className="mt-1 max-w-full rounded" />
          ))}
          {run.stderr && <pre className="whitespace-pre-wrap font-mono text-amber-700 dark:text-amber-300">{run.stderr}</pre>}
          {!run.ok && <pre role="alert" className="whitespace-pre-wrap font-mono text-ink-danger">{run.error}</pre>}
          {run.ok && !run.stdout && !run.result && run.images.length === 0 && !run.stderr && (
            <p className="text-ink-tertiary">Ran with no output.</p>
          )}
        </div>
      )}
    </div>
  );
}
