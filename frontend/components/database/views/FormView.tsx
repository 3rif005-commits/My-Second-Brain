"use client";

// Form view (Milestone 13, task-44) — the AUTHENTICATED owner's editor for
// what a public form (Task 43, running in parallel against the same
// `config` contract) looks like.
//
// REBUILT for M12's own dedicated pass (2026-09-02), against a live capture
// of real Notion's Form builder (docs/ui-specs/form-view.md) — the pre-M12
// version was a plain settings-list-plus-checkboxes editor; real Notion's
// Form builder is a WYSIWYG surface: each question renders as its own
// answer-input PREVIEW (a disabled text field / radio list / checkbox list,
// per the property's type), edited in place via a "···" "Question options"
// popover, not a separate form. This file matches that shape.
//
// `config` contract (task-44-brief.md, agreed with Task 43 — do not
// diverge on the FIELDS TASK 43 READS):
//   is_form_closed: boolean               // default false
//   submission_permissions: "none"        // the ONLY value this app ever writes
//   questions: [{ property_key, required, description?, long_answer?,
//                 display_as?, label?, sync_with_name? }]
//   submit_screen: { button_text, button_color, confirmation_title, confirmation_body }
//
// The five NEW per-question fields (description/long_answer/display_as/
// label/sync_with_name) are additive — task-44-brief's original four fields
// are untouched, and `readFormQuestions` tolerates their absence exactly
// like it always tolerated a missing `required`. Task 43's own
// `PublicFormClient.tsx` doesn't read them yet (a disclosed, named gap —
// form-view.md's own "Deferred" section), so they only affect what the
// OWNER sees while building, not what a respondent sees. Widening that is
// out of scope for a single M12 session: PublicFormClient.tsx is Task 43's
// surface, briefed and built independently, and touching its own contract
// unilaterally is exactly the kind of silent scope creep this workstream
// avoids elsewhere (M8/M9's own "flag it, don't silently expand" calls).
//
// submission_permissions ("why only one value is real", task-44-brief.md):
// Notion's fuller pickers ("Who can fill out": member/public/closed; a
// separate "Access to submission" respondent-visibility control) both need
// a membership/respondent-account concept this single-owner app has none
// of — CONFIRMED, not just assumed, by this session's own live capture
// (form-view.md's "Change" section). Every `onConfigChange` call below
// still forces `submission_permissions: "none"` into the outgoing patch
// explicitly (never left to fall out of a stored default), so the
// contract's invariant holds no matter which control triggered the save —
// see FormView.test.tsx's dedicated assertions across every save path.
//
// Property picker: same list-editing interaction ButtonActionChainEditor.tsx
// already uses for its own action chain (Move up/down via a submenu, no
// drag-and-drop library pulled in for one list) rather than inventing a new
// convention. Available properties are filtered with the same
// `isKnownPropertyType` allow-list TemplateEditor.tsx uses for its own
// property list — excludes formula/rollup/relation/button/computed-and-
// otherwise-unwritable types, reused rather than re-derived. Notion's own
// capture offers 11 question types, three of which (Person/Files & media/
// Phone/Place — four, not three) this app has no dedicated cell for at all;
// "New question" (creating a brand-new property FROM the form) is real,
// captured, and deliberately NOT built this session — form-view.md's own
// "Deferred" section names it.
//
// Debounce: submit-screen text/color fields debounce-PATCH at 600ms,
// matching TemplateEditor.tsx's own name/icon/properties debounce exactly
// (same duration, same on-blur-flush). Structural changes (questions add/
// remove/reorder/required/description/long_answer/display_as/label/sync,
// is_form_closed) PATCH immediately, matching Board's/TemplateEditor's own
// toggle convention — every one of these is a discrete decision, not
// continuous typing, except `label`/`description` text edits themselves,
// which commit on blur (no debounce needed — there's no keystroke-rate
// concern for a field that only ever gets one edit session at a time).
//
// Copy link: `${window.location.origin}/forms/{viewId}` (Task 43's public
// route — no `/api` prefix, that's the submit route only), same clipboard-
// write + "Copied!" 2s transient state NoteEditorPage.tsx's own share-link
// button already uses (matched rather than inventing a new copy-link
// affordance).
import { useRef, useState } from "react";
import { Check, Link as LinkIcon, MoreHorizontal, Plus } from "lucide-react";
import {
  Asterisk,
  AlignLeft,
  ArrowLeftRight,
  ArrowUpDown,
  Copy as CopyIcon,
  LayoutGrid,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Popover, MenuList } from "@/components/ui/primitives";
import type { MenuPanel, MenuRow } from "@/components/ui/primitives";
import { isKnownPropertyType } from "@/lib/database/types";
import type { PropertyResponse } from "@/lib/database/types";
import { propertyTypeIcon, TYPE_LABELS } from "../ColumnHeaderMenu";
import { editPropertyPanel, hasEditableConfig, type SelectOption } from "../EditPropertyPanel";

export type FormQuestionDisplayAs = "list" | "dropdown";

export interface FormQuestion {
  property_key: string;
  required: boolean;
  /** Presence (even `""`) means the "Description" toggle is on — an inline
   * caption line rendered under the label, editable in place. Absent means
   * the toggle is off. Modeled as presence-of-key rather than a separate
   * boolean because that's the one value there is to store. */
  description?: string;
  /** Text/long-text types only — renders the answer preview as a textarea
   * instead of a single-line input. Meaningless (and never offered) for any
   * other type. */
  long_answer?: boolean;
  /** select/status only — Notion's own "Show options as" toggle. Defaults to
   * "list" when absent, matching the captured default. */
  display_as?: FormQuestionDisplayAs;
  /** Only meaningful when `sync_with_name` is `false`. The question's own
   * label, independent of the underlying property's name. */
  label?: string;
  /** Defaults to `true` when absent (Notion's own captured default for a
   * freshly-added question). `false` means the label above no longer
   * follows the property's own name — `label` takes over instead. */
  sync_with_name?: boolean;
}

export interface FormSubmitScreen {
  button_text: string;
  button_color: string;
  confirmation_title: string;
  confirmation_body: string;
}

// This app's existing primary-button colour — tailwind.config.ts's own
// `brand.600` design-token comment: "indigo-600 is the primary brand
// colour" (`#4f46e5`). Default `submit_screen.button_color`.
export const DEFAULT_BUTTON_COLOR = "#4f46e5";

const DEFAULT_SUBMIT_SCREEN: FormSubmitScreen = {
  button_text: "Submit",
  button_color: DEFAULT_BUTTON_COLOR,
  confirmation_title: "Thanks!",
  confirmation_body: "",
};

/** Tolerates a missing/malformed shape (default `false`, never a throw) —
 * same "tolerates unknown... drops them at read" spirit spec §10 already
 * states for view config generally (see `getGroupBySpec` etc. in
 * `lib/database/types.ts`). */
export function readIsFormClosed(config: Record<string, unknown>): boolean {
  return config.is_form_closed === true;
}

export function readFormQuestions(config: Record<string, unknown>): FormQuestion[] {
  if (!Array.isArray(config.questions)) return [];
  return config.questions
    .filter(
      (q): q is Record<string, unknown> =>
        !!q && typeof q === "object" && typeof (q as Record<string, unknown>).property_key === "string"
    )
    .map((q) => ({
      property_key: q.property_key as string,
      required: q.required === true,
      description: typeof q.description === "string" ? q.description : undefined,
      long_answer: q.long_answer === true ? true : undefined,
      display_as: q.display_as === "dropdown" ? "dropdown" : q.display_as === "list" ? "list" : undefined,
      label: typeof q.label === "string" ? q.label : undefined,
      sync_with_name: q.sync_with_name === false ? false : undefined,
    }));
}

export function readSubmitScreen(config: Record<string, unknown>): FormSubmitScreen {
  const raw = config.submit_screen;
  if (!raw || typeof raw !== "object") return DEFAULT_SUBMIT_SCREEN;
  const r = raw as Record<string, unknown>;
  return {
    button_text: typeof r.button_text === "string" ? r.button_text : DEFAULT_SUBMIT_SCREEN.button_text,
    button_color: typeof r.button_color === "string" ? r.button_color : DEFAULT_SUBMIT_SCREEN.button_color,
    confirmation_title:
      typeof r.confirmation_title === "string" ? r.confirmation_title : DEFAULT_SUBMIT_SCREEN.confirmation_title,
    confirmation_body:
      typeof r.confirmation_body === "string" ? r.confirmation_body : DEFAULT_SUBMIT_SCREEN.confirmation_body,
  };
}

async function errorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.detail || body?.error || `Request failed (${res.status})`;
}

const TEXT_LIKE = ["title", "rich_text"];
const SELECT_LIKE = ["select", "status"];

function questionLabel(question: FormQuestion, property: PropertyResponse): string {
  return question.sync_with_name === false ? (question.label ?? property.name) : property.name;
}

/** The generic "name + type" read-only panel Notion's own "View linked
 * property" opens for a type with no dedicated config editor (everything
 * `hasEditableConfig` excludes) — the same two facts its OWN richer panel
 * shows for number/select/multi_select/status, just without a config
 * editor underneath since there's nothing to configure. */
function propertyInfoPanel(property: PropertyResponse): MenuPanel {
  return {
    title: "Edit property",
    sections: [
      {
        rows: [
          { id: "name", label: property.name, description: "Name", onSelect: () => {} },
          { id: "type", label: TYPE_LABELS[property.type] ?? property.type, description: "Type", onSelect: () => {} },
        ],
      },
    ],
  };
}

function buildQuestionOptionsPanel(args: {
  question: FormQuestion;
  property: PropertyResponse;
  index: number;
  total: number;
  onPatch: (patch: Partial<FormQuestion>) => void;
  onMove: (direction: -1 | 1) => void;
  onPatchPropertyConfig: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}): MenuPanel {
  const { question, property, index, total, onPatch, onMove, onPatchPropertyConfig, onDelete } = args;
  const isTextLike = TEXT_LIKE.includes(property.type);
  const isSelectLike = SELECT_LIKE.includes(property.type);

  const rows: MenuRow[] = [
    {
      id: "required",
      icon: <Asterisk size={14} />,
      label: "Required",
      kind: "toggle",
      checked: question.required,
      onSelect: () => onPatch({ required: !question.required }),
    },
    {
      id: "description",
      icon: <AlignLeft size={14} />,
      label: "Description",
      kind: "toggle",
      checked: question.description !== undefined,
      onSelect: () => onPatch({ description: question.description === undefined ? "" : undefined }),
    },
  ];

  if (isTextLike) {
    rows.push({
      id: "long-answer",
      icon: <ArrowLeftRight size={14} />,
      label: "Long answer",
      kind: "toggle",
      checked: !!question.long_answer,
      onSelect: () => onPatch({ long_answer: !question.long_answer }),
    });
  }

  if (isSelectLike) {
    rows.push({
      id: "show-options-as",
      icon: <LayoutGrid size={14} />,
      label: "Show options as",
      value: question.display_as === "dropdown" ? "Dropdown" : "List view",
      submenu: (): MenuPanel => ({
        sections: [
          {
            rows: [
              {
                id: "list",
                label: "List view",
                checked: question.display_as !== "dropdown",
                onSelect: () => onPatch({ display_as: "list" }),
              },
              {
                id: "dropdown",
                label: "Dropdown",
                checked: question.display_as === "dropdown",
                onSelect: () => onPatch({ display_as: "dropdown" }),
              },
            ],
          },
        ],
      }),
    });
  }

  rows.push(
    {
      id: "question-type",
      icon: <LayoutGrid size={14} />,
      label: "Question type",
      value: TYPE_LABELS[property.type] ?? property.type,
      disabled: true,
      disabledReason: "Change a property's type from its own column header menu",
    },
    {
      id: "view-linked-property",
      label: "View linked property",
      submenu: (): MenuPanel =>
        hasEditableConfig(property.type)
          ? editPropertyPanel({ type: property.type, config: property.config ?? {}, onPatchConfig: onPatchPropertyConfig })!
          : propertyInfoPanel(property),
    },
    {
      id: "sync-with-property-name",
      icon: <RefreshCw size={14} />,
      label: "Sync with property name",
      kind: "toggle",
      checked: question.sync_with_name !== false,
      onSelect: () =>
        onPatch(
          question.sync_with_name === false
            ? { sync_with_name: undefined, label: undefined }
            : { sync_with_name: false, label: question.label ?? property.name }
        ),
    },
    {
      id: "move-question",
      icon: <ArrowUpDown size={14} />,
      label: "Move question",
      submenu: (): MenuPanel => ({
        sections: [
          {
            rows: [
              { id: "up", label: "Move up", disabled: index === 0, onSelect: () => onMove(-1) },
              { id: "down", label: "Move down", disabled: index === total - 1, onSelect: () => onMove(1) },
            ],
          },
        ],
      }),
    },
    {
      id: "conditional-logic",
      icon: <Sparkles size={14} />,
      label: "Add conditional logic",
      disabled: true,
      disabledReason: "Notion's own Business-plan feature — this app has no conditional-logic engine",
    },
    {
      id: "duplicate",
      icon: <CopyIcon size={14} />,
      label: "Duplicate question",
      disabled: true,
      disabledReason: "Would need to duplicate the underlying property, not built",
    },
    {
      id: "delete",
      icon: <Trash2 size={14} />,
      label: "Delete question",
      danger: true,
      onSelect: onDelete,
    }
  );

  return { title: "Question options", sections: [{ rows }] };
}

function QuestionAnswerPreview({
  property,
  question,
  onCreateOption,
}: {
  property: PropertyResponse;
  question: FormQuestion;
  onCreateOption: () => void;
}) {
  const inputClass =
    "w-full text-sm px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-500 placeholder:text-gray-400";

  if (property.type === "number") {
    return <input disabled placeholder="Respondent's answer" className={inputClass} />;
  }
  if (property.type === "date") {
    return <input disabled type="date" className={inputClass} />;
  }
  if (property.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <input disabled type="checkbox" />
        Yes
      </label>
    );
  }
  if (property.type === "select" || property.type === "status" || property.type === "multi_select") {
    const options = ((property.config?.options as SelectOption[] | undefined) ?? []) as SelectOption[];
    if (question.display_as === "dropdown" && property.type !== "multi_select") {
      return (
        <button disabled type="button" className={`${inputClass} text-left flex items-center justify-between`}>
          <span>Select an option</span>
          <span aria-hidden>⌄</span>
        </button>
      );
    }
    return (
      <div className="space-y-1.5">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <input disabled type={property.type === "multi_select" ? "checkbox" : "radio"} />
            {o.name}
          </label>
        ))}
        <button
          type="button"
          onClick={onCreateOption}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <Plus size={12} /> Add option
        </button>
      </div>
    );
  }
  // title/rich_text and any other addable-but-otherwise-unhandled type.
  return question.long_answer ? (
    <textarea disabled rows={3} placeholder="Respondent's answer" className={inputClass} />
  ) : (
    <input disabled placeholder="Respondent's answer" className={inputClass} />
  );
}

function QuestionCard({
  question,
  property,
  index,
  total,
  onPatch,
  onMove,
  onDelete,
  onPatchPropertyConfig,
  onCreateOption,
}: {
  question: FormQuestion;
  property: PropertyResponse;
  index: number;
  total: number;
  onPatch: (patch: Partial<FormQuestion>) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  onPatchPropertyConfig: (patch: Record<string, unknown>) => void;
  onCreateOption: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState(questionLabel(question, property));
  const [descDraft, setDescDraft] = useState(question.description ?? "");

  return (
    <div
      data-testid={`question-card-${index}`}
      className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        {question.sync_with_name === false ? (
          <div className="flex-1 min-w-0 flex items-center gap-1">
            <input
              aria-label={`Question ${index + 1} label`}
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={() => labelDraft.trim() && onPatch({ label: labelDraft.trim() })}
              className="flex-1 min-w-0 text-base font-semibold bg-transparent outline-none text-gray-900 dark:text-gray-100"
            />
            {question.required && <span className="text-red-500">*</span>}
          </div>
        ) : (
          <h3 className="flex-1 min-w-0 text-base font-semibold text-gray-900 dark:text-gray-100">
            {property.name}
            {question.required && <span className="text-red-500"> *</span>}
          </h3>
        )}
        <Popover
          open={menuOpen}
          onOpenChange={setMenuOpen}
          label="Question options"
          trigger={
            <button
              type="button"
              aria-label={`Question ${index + 1} options`}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded"
            >
              <MoreHorizontal size={16} />
            </button>
          }
        >
          <MenuList
            root={buildQuestionOptionsPanel({
              question,
              property,
              index,
              total,
              onPatch: (patch) => {
                setMenuOpen(false);
                onPatch(patch);
              },
              onMove: (direction) => {
                setMenuOpen(false);
                onMove(direction);
              },
              onPatchPropertyConfig,
              onDelete: () => {
                setMenuOpen(false);
                onDelete();
              },
            })}
            nav="flyout"
            onClose={() => setMenuOpen(false)}
            label="Question options"
          />
        </Popover>
      </div>

      {question.description !== undefined && (
        <input
          aria-label={`Question ${index + 1} description`}
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          onBlur={() => onPatch({ description: descDraft })}
          placeholder="Add description"
          className="w-full text-xs bg-transparent outline-none text-gray-400 dark:text-gray-500 placeholder:text-gray-400"
        />
      )}

      <QuestionAnswerPreview property={property} question={question} onCreateOption={onCreateOption} />
    </div>
  );
}

export interface FormViewProps {
  viewId: string;
  properties: PropertyResponse[];
  config: Record<string, unknown>;
  onConfigChange: (patch: Record<string, unknown>) => void;
  /** Re-fetches `properties` after a question-level property write (a new
   * Select/Multi-select option) so the answer preview reflects it — the
   * same "the caller owns refetch" convention AddPropertyPopover.tsx and
   * TableView.tsx's own `createSelectOption` already use. Optional so
   * existing callers (and this file's own tests) that never write a
   * property don't have to supply a no-op. */
  onPropertiesChanged?: () => void | Promise<void>;
}

export function FormView({ viewId, properties, config, onConfigChange, onPropertiesChanged }: FormViewProps) {
  const isFormClosed = readIsFormClosed(config);
  const questions = readFormQuestions(config);
  const submitScreen = readSubmitScreen(config);

  // Same skip-list TemplateEditor.tsx's own property section already makes
  // (formula/rollup/relation/button/computed-and-otherwise-unwritable) —
  // reused via `isKnownPropertyType`, not re-derived here.
  const knownProperties = properties.filter((p) => isKnownPropertyType(p.type));
  const selectedKeys = new Set(questions.map((q) => q.property_key));
  const availableProperties = knownProperties.filter((p) => !selectedKeys.has(p.key));
  const propertyByKey = new Map(knownProperties.map((p) => [p.key, p]));

  const [addOpen, setAddOpen] = useState(false);

  function saveQuestions(next: FormQuestion[]) {
    onConfigChange({ questions: next, submission_permissions: "none" });
  }

  function handleAddQuestion(propertyKey: string) {
    saveQuestions([...questions, { property_key: propertyKey, required: false }]);
  }
  function handlePatchQuestion(index: number, patch: Partial<FormQuestion>) {
    saveQuestions(questions.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }
  function handleRemoveQuestion(index: number) {
    saveQuestions(questions.filter((_, i) => i !== index));
  }
  function handleMoveQuestion(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[index], next[target]] = [next[target], next[index]];
    saveQuestions(next);
  }

  async function patchPropertyConfig(propertyId: string, currentConfig: Record<string, unknown>, patch: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/db/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ...currentConfig, ...patch } }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      await onPropertiesChanged?.();
    } catch {
      // Same silent-console-only convention EditPropertyPanel's own callers
      // (ColumnHeaderMenu.tsx) use elsewhere for a config PATCH — a toast
      // here would need threading `useToast` through one more layer for a
      // failure mode (an option-color/format tweak failing) this codebase
      // doesn't already surface loudly for the identical panel's other host.
    }
  }

  // Same auto-named-placeholder convention EditPropertyPanel.tsx's own
  // `addOption` uses ("Option N", renamed afterward) — this IS that same
  // per-type options list, reached from a second entry point, not a
  // create-on-type flow like SelectCell's (there is no text the respondent
  // typed to name it from; the form builder adds options ahead of time).
  async function createOption(property: PropertyResponse) {
    const options = ((property.config?.options as SelectOption[] | undefined) ?? []) as SelectOption[];
    const next: SelectOption[] = [
      ...options,
      { id: Math.random().toString(36).slice(2, 10), name: `Option ${options.length + 1}`, color: "default" },
    ];
    await patchPropertyConfig(property.id, property.config, { options: next });
  }

  // ── Submit-screen fields: local draft + 600ms debounce, mirrors
  // TemplateEditor.tsx's name/icon inputs exactly (same duration, same
  // on-blur-flush pattern) rather than PATCHing on every keystroke. Not
  // re-synced from `config` after mount — same as TemplateEditor's own
  // `name`/`icon` state — since the only writer of `config.submit_screen`
  // this app has is this component's own debounced save.
  const [draftSubmitScreen, setDraftSubmitScreen] = useState<FormSubmitScreen>(submitScreen);
  const submitScreenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleSaveSubmitScreen(next: FormSubmitScreen) {
    if (submitScreenDebounceRef.current) clearTimeout(submitScreenDebounceRef.current);
    submitScreenDebounceRef.current = setTimeout(() => {
      onConfigChange({ submit_screen: next, submission_permissions: "none" });
    }, 600);
  }

  function handleSubmitScreenChange(field: keyof FormSubmitScreen, value: string) {
    setDraftSubmitScreen((prev) => {
      const next = { ...prev, [field]: value };
      scheduleSaveSubmitScreen(next);
      return next;
    });
  }

  function handleSubmitScreenBlur() {
    if (submitScreenDebounceRef.current) clearTimeout(submitScreenDebounceRef.current);
    onConfigChange({ submit_screen: draftSubmitScreen, submission_permissions: "none" });
  }

  function handleToggleClosed(checked: boolean) {
    onConfigChange({ is_form_closed: checked, submission_permissions: "none" });
  }

  // ── Share / copy link ───────────────────────────────────────────────
  const [linkCopied, setLinkCopied] = useState(false);
  const formUrl = typeof window !== "undefined" ? `${window.location.origin}/forms/${viewId}` : `/forms/${viewId}`;

  async function copyFormLink() {
    await navigator.clipboard.writeText(formUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  const addQuestionPanel: MenuPanel = {
    search: { placeholder: "Search properties..." },
    sections: [
      {
        label: "Existing properties",
        rows: availableProperties.map((p) => ({
          id: p.key,
          icon: propertyTypeIcon(p.type),
          label: p.name,
          description: TYPE_LABELS[p.type] ?? p.type,
          onSelect: () => {
            setAddOpen(false);
            handleAddQuestion(p.key);
          },
        })),
      },
    ],
  };

  return (
    <div data-testid="form-view" className="h-full overflow-auto p-4 space-y-6 text-sm">
      {/* Permission line — static text, no picker (task-44-brief.md's
       * treatment (a), re-confirmed by this session's own live capture of
       * Notion's richer "Who can fill out"/"Access to submission" pair:
       * both need a membership/respondent-account concept this app has
       * none of). */}
      <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
        <span aria-hidden>🔒</span> Only you can fill out this form. Respondents cannot view their submission
        afterward.
      </p>

      {/* Questions — WYSIWYG cards, not a settings list. */}
      <div className="space-y-3">
        {questions.map((q, index) => {
          const property = propertyByKey.get(q.property_key);
          if (!property) return null;
          return (
            <QuestionCard
              key={`${q.property_key}-${index}`}
              question={q}
              property={property}
              index={index}
              total={questions.length}
              onPatch={(patch) => handlePatchQuestion(index, patch)}
              onMove={(direction) => handleMoveQuestion(index, direction)}
              onDelete={() => handleRemoveQuestion(index)}
              onPatchPropertyConfig={(patch) => patchPropertyConfig(property.id, property.config, patch)}
              onCreateOption={() => createOption(property)}
            />
          );
        })}
      </div>

      {availableProperties.length > 0 && (
        <div className="flex justify-center">
          <Popover
            open={addOpen}
            onOpenChange={setAddOpen}
            label="Add question"
            trigger={
              <button
                type="button"
                aria-label="Add question"
                className="h-8 w-8 flex items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100"
              >
                <Plus size={16} />
              </button>
            }
          >
            <MenuList root={addQuestionPanel} nav="flyout" onClose={() => setAddOpen(false)} label="Add question" />
          </Popover>
        </div>
      )}

      {/* Settings — kept inline (a disclosed simplification: real Notion
       * hosts these behind the toolbar's own sliders "Form settings"
       * popover, form-view.md's own "Deferred" section — this app has no
       * per-view-type toolbar entry point to hang a second popover from
       * yet, and building one is a bigger change than this section). */}
      <section className="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-800">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Settings</h3>

        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            aria-label="Closed for submissions"
            checked={isFormClosed}
            onChange={(e) => handleToggleClosed(e.target.checked)}
          />
          Closed — stop accepting new responses
        </label>

        <div className="space-y-2 pl-0.5">
          <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Submit screen</p>
          <label className="flex items-center gap-2 text-xs">
            <span className="w-32 shrink-0 text-gray-500 dark:text-gray-400">Button text</span>
            <input
              aria-label="Submit button text"
              value={draftSubmitScreen.button_text}
              onChange={(e) => handleSubmitScreenChange("button_text", e.target.value)}
              onBlur={handleSubmitScreenBlur}
              className="flex-1 text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="w-32 shrink-0 text-gray-500 dark:text-gray-400">Button color</span>
            <input
              aria-label="Submit button color"
              type="color"
              value={draftSubmitScreen.button_color}
              onChange={(e) => handleSubmitScreenChange("button_color", e.target.value)}
              onBlur={handleSubmitScreenBlur}
              className="h-7 w-10 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="w-32 shrink-0 text-gray-500 dark:text-gray-400">Confirmation title</span>
            <input
              aria-label="Confirmation title"
              value={draftSubmitScreen.confirmation_title}
              onChange={(e) => handleSubmitScreenChange("confirmation_title", e.target.value)}
              onBlur={handleSubmitScreenBlur}
              className="flex-1 text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="w-32 shrink-0 text-gray-500 dark:text-gray-400">Confirmation body</span>
            <input
              aria-label="Confirmation body"
              value={draftSubmitScreen.confirmation_body}
              onChange={(e) => handleSubmitScreenChange("confirmation_body", e.target.value)}
              onBlur={handleSubmitScreenBlur}
              className="flex-1 text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
          </label>
        </div>
      </section>

      {/* Share */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Share</h3>
        {isFormClosed && (
          <div
            data-testid="form-closed-badge"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded"
          >
            Closed — not accepting responses
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            readOnly
            aria-label="Form link"
            value={formUrl}
            className="flex-1 text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
          />
          <button
            type="button"
            onClick={copyFormLink}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded bg-indigo-600 text-white"
          >
            {linkCopied ? <Check size={13} /> : <LinkIcon size={13} />}
            {linkCopied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </section>
    </div>
  );
}
