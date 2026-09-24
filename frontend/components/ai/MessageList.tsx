"use client";

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Markdown } from "@/lib/markdown/Markdown";
import { resolveCitations } from "@/lib/answerToHtml";
import type { Citation } from "@/lib/workspace";
import { ToolEvent } from "./ToolEvent";
import { SkillBadge } from "./SkillBadge";
import { UploadCard, type PanelJob } from "./PanelCards";
import { Answer } from "./Answer";
import type { UploadFile } from "./panelSources";

export type StreamItem =
  | { kind: "user"; id: string; content: string }
  | { kind: "assistant"; id: string; content: string; streaming?: boolean;
      /** Answered from a note's sources: [n] markers resolve through these,
       *  and the answer can be inserted into that note. */
      citations?: Citation[]; scopeNoteId?: string;
      /** Where Insert put it; `undoNote` says why Undo could not. */
      inserted?: string; undoNote?: string }
  | { kind: "job"; id: string; job: PanelJob }
  | { kind: "upload"; id: string; title: string; files: UploadFile[] }
  | { kind: "notice"; id: string; content: string }
  | { kind: "skill"; id: string; name: string }
  | { kind: "tool"; id: string; tool: string; args: Record<string, unknown>;
      summary?: string; denied?: string;
      /** Refused only for want of a human decision — render a Confirm button. */
      requiresApproval?: boolean; approvalKey?: string };

interface Props {
  items: StreamItem[];
  onApprove?: (approvalKey: string) => void;
  /** The side panel renders its job cards (they carry its actions). */
  renderJob?: (item: Extract<StreamItem, { kind: "job" }>) => ReactNode;
  /** Actions under a finished answer, e.g. Insert into note. */
  renderAnswerActions?: (item: Extract<StreamItem, { kind: "assistant" }>) => ReactNode;
  /** In the workspace: [n] become chips that jump to the cited page. */
  onCitation?: (c: Citation) => void;
  colorIndex?: Map<string, number>;
}

export function MessageList({ items, onApprove, renderJob, renderAnswerActions, onCitation, colorIndex }: Props) {
  return (
    <div className="px-4 py-5 flex flex-col gap-4">
      {items.map((item) => {
        if (item.kind === "user") {
          return (
            <div key={item.id} className="flex justify-end">
              <div className="max-w-[84%] bg-indigo-600 text-white rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm leading-relaxed shadow-sm">
                <p className="whitespace-pre-wrap">{item.content}</p>
              </div>
            </div>
          );
        }

        if (item.kind === "job") {
          return <div key={item.id}>{renderJob?.(item)}</div>;
        }

        if (item.kind === "upload") {
          return <UploadCard key={item.id} title={item.title} files={item.files} />;
        }

        if (item.kind === "notice") {
          return (
            <p key={item.id} className="text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400 px-1">
              {item.content}
            </p>
          );
        }

        if (item.kind === "skill") {
          return <SkillBadge key={item.id} name={item.name} />;
        }

        if (item.kind === "tool") {
          return (
            <ToolEvent
              key={item.id}
              tool={item.tool}
              args={item.args}
              summary={item.summary}
              deniedReason={item.denied}
              requiresApproval={item.requiresApproval}
              onApprove={item.approvalKey && onApprove
                ? () => onApprove(item.approvalKey!)
                : undefined}
            />
          );
        }

        // assistant
        return (
          <div key={item.id} className="flex gap-2.5 items-start">
            {/* Avatar */}
            <div className="mt-0.5 w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0 shadow-sm">
              <Sparkles size={11} className="text-white" />
            </div>

            {/* Message card */}
            <div className="flex-1 min-w-0 bg-white dark:bg-gray-800/60 rounded-2xl rounded-tl-sm px-3.5 py-2.5 shadow-sm border border-gray-100 dark:border-gray-700/50">
              <div className="text-sm text-gray-800 dark:text-gray-100 leading-relaxed prose-sm prose dark:prose-invert max-w-none">
                {onCitation && item.citations?.length
                  ? <Answer content={item.content} citations={item.citations}
                      colorIndex={colorIndex ?? new Map()} onCitation={onCitation} />
                  : <Markdown>{item.citations?.length ? resolveCitations(item.content, item.citations) : item.content}</Markdown>}
              </div>
              {item.streaming && (
                <span className="inline-block w-0.5 h-[1em] bg-indigo-400 animate-pulse ml-0.5 align-middle rounded-full" />
              )}
              {!item.streaming && item.content && renderAnswerActions?.(item)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
