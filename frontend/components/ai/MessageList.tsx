"use client";

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Markdown } from "@/lib/markdown/Markdown";
import { resolveCitations } from "@/lib/answerToHtml";
import type { Citation } from "@/lib/workspace";
import { previewInserts, type SourceInsert } from "@/lib/sourceInserts";
import { ToolEvent } from "./ToolEvent";
import { SkillBadge } from "./SkillBadge";
import { SkillDraftCard } from "./SkillDraftCard";
import { RunnablePre } from "./RunnablePython";

/** Python blocks in an answer get Run (browser sandbox, your click only). */
const RUNNABLE = { pre: RunnablePre };
import type { SkillDraftProposal } from "@/lib/skills";
import { UploadCard, type PanelJob } from "./PanelCards";
import { Answer } from "./Answer";
import { holdBackOpenTail } from "@/lib/markdown/streamingTail";
import { RouteBadge, type RouteInfo } from "./RouteBadge";
import type { UploadFile } from "./panelSources";
import { linkBareNoteRefs } from "@/lib/markdown/blockPreview";
import { BlockPreviewLink } from "@/lib/markdown/components/BlockPreviewLink";

export type StreamItem =
  | { kind: "user"; id: string; content: string }
  | { kind: "assistant"; id: string; content: string; streaming?: boolean;
      /** Answered from a note's sources: [n] markers resolve through these,
       *  and the answer can be inserted into that note. */
      citations?: Citation[]; scopeNoteId?: string;
      /** What the source tools made this turn, by token ([[src:…]] in the text). */
      inserts?: SourceInsert[];
      /** Where Insert put it; `undoNote` says why Undo could not. */
      inserted?: string; undoNote?: string;
      /** Where it ran and why (routing). `private`: written from private
       *  notes on the device — a later cloud turn gets a placeholder. */
      route?: RouteInfo; private?: boolean;
      /** The question it answers — "Ask again on…" replays it. */
      query?: string;
      /** The notes this answer was given to read (after the privacy gate),
       *  shown as links under it — so the reader can check them even when
       *  the model forgets to cite. */
      sources?: { title: string; href: string }[] }
  | { kind: "privacy"; id: string; query: string; withheld: { id: string; title: string }[];
      slot: string; model?: string; scopeNoteId?: string; resolved?: string }
  | { kind: "job"; id: string; job: PanelJob }
  | { kind: "upload"; id: string; title: string; files: UploadFile[] }
  | { kind: "notice"; id: string; content: string }
  | { kind: "skill"; id: string; name: string }
  /** A skill the chat proposed; saved only by the user's click on the card. */
  | { kind: "skill_draft"; id: string; draft: SkillDraftProposal }
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
  /** The privacy prompt carries the panel's actions. */
  renderPrivacy?: (item: Extract<StreamItem, { kind: "privacy" }>) => ReactNode;
  /** Ask an answer's question again on another slot. */
  onRerun?: (item: Extract<StreamItem, { kind: "assistant" }>, slot: string) => void;
  busy?: boolean;
  /** In the workspace: [n] become chips that jump to the cited page. */
  onCitation?: (c: Citation) => void;
  colorIndex?: Map<string, number>;
}

export function MessageList({ items, onApprove, renderJob, renderAnswerActions, renderPrivacy, onRerun, busy, onCitation, colorIndex }: Props) {
  return (
    <div className="px-4 py-5 flex flex-col gap-5">
      {items.map((item, i) => {
        if (item.kind === "user") {
          return (
            <div key={item.id} className="flex justify-end">
              {/* Your words: a quiet grey bubble, like a comment in the page, not a chat app's blue */}
              <div className="max-w-[85%] rounded-xl bg-surface-hover px-3 py-2 text-[14px] leading-relaxed text-ink">
                <p className="whitespace-pre-wrap">{item.content}</p>
              </div>
            </div>
          );
        }

        if (item.kind === "job") {
          return <div key={item.id}>{renderJob?.(item)}</div>;
        }

        if (item.kind === "privacy") {
          return <div key={item.id}>{renderPrivacy?.(item)}</div>;
        }

        if (item.kind === "upload") {
          return <UploadCard key={item.id} title={item.title} files={item.files} />;
        }

        if (item.kind === "notice") {
          return (
            <p key={item.id} className="text-[12.5px] leading-relaxed text-ink-tertiary px-1">
              {item.content}
            </p>
          );
        }

        if (item.kind === "skill") {
          // Skills load in a burst at the start of a turn: one chip for the
          // run, not one per skill (three chips led every answer).
          if (items[i - 1]?.kind === "skill") return null;
          const names: string[] = [];
          for (let j = i; items[j]?.kind === "skill"; j++) {
            const name = (items[j] as Extract<StreamItem, { kind: "skill" }>).name;
            if (!names.includes(name)) names.push(name);
          }
          return <SkillBadge key={item.id} names={names} />;
        }

        if (item.kind === "skill_draft") {
          return <SkillDraftCard key={item.id} draft={item.draft} />;
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
            <div className="mt-[3px] flex size-5 shrink-0 items-center justify-center rounded-md bg-accent-500/10">
              <Sparkles size={11} className="text-accent" />
            </div>

            {/* The answer reads as text on the page, as a note does: no card around it */}
            <div className="flex-1 min-w-0">
              <div className="text-[14px] text-ink leading-relaxed prose-sm prose dark:prose-invert max-w-none prose-p:my-1.5">
                {(() => {
                  // mid-stream, an unfinished link or formula waits for its end
                  const content = previewInserts(
                    item.streaming ? holdBackOpenTail(item.content) : item.content, item.inserts);
                  return onCitation && item.citations?.length
                    ? <Answer content={linkBareNoteRefs(content)} citations={item.citations}
                        colorIndex={colorIndex ?? new Map()} onCitation={onCitation} />
                    : <Markdown components={RUNNABLE}>{linkBareNoteRefs(item.citations?.length ? resolveCitations(content, item.citations) : content)}</Markdown>;
                })()}
              </div>
              {item.streaming && (
                <span className="inline-block w-0.5 h-[1em] bg-accent-400 animate-pulse ml-0.5 align-middle rounded-full" />
              )}
              {item.route && (
                <RouteBadge route={item.route} busy={busy}
                  onRerun={onRerun && item.query && !item.streaming ? (slot) => onRerun(item, slot) : undefined} />
              )}
              {!item.streaming && item.content && item.sources?.length ? (
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11.5px] text-gray-500 dark:text-gray-400">
                  <span>Read from your notes:</span>
                  {item.sources.map((s) => (
                    <BlockPreviewLink key={s.href} href={s.href}>{s.title}</BlockPreviewLink>
                  ))}
                </div>
              ) : null}
              {!item.streaming && item.content && renderAnswerActions?.(item)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
