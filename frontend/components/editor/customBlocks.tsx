"use client";

// Custom BlockNote blocks used by workspace notes (and available everywhere):
//   math       — KaTeX-rendered LaTeX, click to edit the source
//   checkpoint — deep link to an exact spot in a workspace resource
//                (timestamp for video, page for documents, section for websites)
import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import katex from "katex";
import "katex/dist/katex.min.css";

function MathRenderer({ latex }: { latex: string }) {
  let html = "";
  let error = false;
  try {
    html = katex.renderToString(latex || "\\text{empty formula}", {
      displayMode: true,
      throwOnError: false,
    });
  } catch {
    error = true;
  }
  if (error) return <code className="text-red-500 text-sm">{latex}</code>;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MathBlockView({ block, editor }: { block: any; editor: any }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(block.props.latex ?? "");

  if (editing) {
    return (
      <div className="w-full my-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/20 p-2">
        <textarea
          autoFocus
          className="w-full bg-transparent font-mono text-sm outline-none resize-y min-h-[48px] text-gray-800 dark:text-gray-200"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              editor.updateBlock(block, { props: { latex: draft } });
              setEditing(false);
            }
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="LaTeX, e.g. \int_0^1 x^2\,dx"
        />
        <div className="flex items-center justify-between mt-1">
          <div className="text-gray-700 dark:text-gray-300 overflow-x-auto">
            <MathRenderer latex={draft} />
          </div>
          <button
            className="text-xs px-2 py-1 rounded bg-indigo-500 text-white hover:bg-indigo-600 shrink-0"
            onClick={() => {
              editor.updateBlock(block, { props: { latex: draft } });
              setEditing(false);
            }}
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full my-1 py-1 px-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60 overflow-x-auto text-gray-800 dark:text-gray-200"
      title="Click to edit LaTeX"
      onClick={() => {
        setDraft(block.props.latex ?? "");
        setEditing(true);
      }}
    >
      <MathRenderer latex={block.props.latex ?? ""} />
    </div>
  );
}

export const MathBlockSpec = createReactBlockSpec(
  {
    type: "math",
    propSchema: {
      latex: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => <MathBlockView block={props.block} editor={props.editor} />,
  }
);

function checkpointHref(p: {
  workspaceId: string; resourceId: string; anchorType: string; value: string;
}): string {
  const key = p.anchorType === "time" ? "t" : p.anchorType === "page" ? "p" : "s";
  return `/brain/workspaces/${p.workspaceId}?resource=${p.resourceId}&${key}=${p.value}`;
}

function fmtAnchor(anchorType: string, value: string): string {
  if (anchorType === "time") {
    const s = Math.floor(Number(value) || 0);
    const mm = Math.floor(s / 60);
    return `${mm}:${String(s % 60).padStart(2, "0")}`;
  }
  if (anchorType === "page") return `p. ${value}`;
  return `§${value}`;
}

export const CheckpointBlockSpec = createReactBlockSpec(
  {
    type: "checkpoint",
    propSchema: {
      workspaceId: { default: "" },
      resourceId: { default: "" },
      anchorType: { default: "time" }, // time | page | section
      value: { default: "0" },
      label: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const p = block.props;
      return (
        <a
          href={checkpointHref(p)}
          className="inline-flex items-center gap-1.5 my-0.5 px-2.5 py-1 rounded-full border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 text-xs font-medium no-underline hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors cursor-pointer"
          contentEditable={false}
        >
          <span>{p.anchorType === "time" ? "⏱" : "📍"}</span>
          <span>{p.label || "Checkpoint"}</span>
          <span className="opacity-70">{fmtAnchor(p.anchorType, p.value)}</span>
        </a>
      );
    },
  }
);
