import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FormView, DEFAULT_BUTTON_COLOR } from "./FormView";
import type { PropertyResponse } from "@/lib/database/types";

function prop(overrides: Partial<PropertyResponse>): PropertyResponse {
  return {
    id: overrides.key ?? "id",
    data_source_id: "ds-1",
    user_id: "user-1",
    key: "key",
    name: "Name",
    type: "rich_text",
    config: {},
    description: null,
    storage: "jsonb",
    column_name: null,
    result_type: null,
    is_volatile: false,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const TITLE_PROP = prop({ key: "title", name: "Title", type: "title", position: 0 });
const STATUS_PROP = prop({ key: "status", name: "Status", type: "status", position: 1 });
const SELECT_PROP = prop({
  key: "select",
  name: "Select",
  type: "select",
  position: 2,
  config: { options: [{ id: "opt-1", name: "Alpha", color: "blue" }] },
});
// Formula/relation are excluded by `isKnownPropertyType` (same skip-list
// TemplateEditor.tsx's own property list already makes) — used below to
// prove the picker never offers them.
const FORMULA_PROP = prop({ key: "computed", name: "Computed", type: "formula", position: 3 });
const RELATION_PROP = prop({ key: "related", name: "Related", type: "relation", position: 4 });

async function openQuestionOptions(user: ReturnType<typeof userEvent.setup>, index: number) {
  await user.click(screen.getByRole("button", { name: `Question ${index + 1} options` }));
}

describe("FormView", () => {
  it("adding a question via the available-properties picker PATCHes the right config.questions shape", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    render(
      <FormView viewId="v1" properties={[TITLE_PROP, STATUS_PROP]} config={{}} onConfigChange={onConfigChange} />
    );

    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.click(screen.getByText("Title"));

    expect(onConfigChange).toHaveBeenCalledWith({
      questions: [{ property_key: "title", required: false }],
      submission_permissions: "none",
    });
  });

  it("does not offer formula/relation (or other unwritable) property types as questions", async () => {
    const user = userEvent.setup();
    render(
      <FormView
        viewId="v1"
        properties={[TITLE_PROP, FORMULA_PROP, RELATION_PROP]}
        config={{}}
        onConfigChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Add question" }));
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.queryByText("Computed")).not.toBeInTheDocument();
    expect(screen.queryByText("Related")).not.toBeInTheDocument();
  });

  it("removing a question PATCHes config.questions without the removed entry", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    render(
      <FormView
        viewId="v1"
        properties={[TITLE_PROP, STATUS_PROP]}
        config={{
          questions: [
            { property_key: "title", required: false },
            { property_key: "status", required: true },
          ],
        }}
        onConfigChange={onConfigChange}
      />
    );

    await openQuestionOptions(user, 0);
    await user.click(screen.getByText("Delete question"));

    expect(onConfigChange).toHaveBeenCalledWith({
      questions: [{ property_key: "status", required: true }],
      submission_permissions: "none",
    });
  });

  it("moving a question down PATCHes config.questions in the swapped order", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    render(
      <FormView
        viewId="v1"
        properties={[TITLE_PROP, STATUS_PROP]}
        config={{
          questions: [
            { property_key: "title", required: false },
            { property_key: "status", required: true },
          ],
        }}
        onConfigChange={onConfigChange}
      />
    );

    await openQuestionOptions(user, 0);
    await user.click(screen.getByText("Move question"));
    await user.click(screen.getByText("Move down"));

    expect(onConfigChange).toHaveBeenCalledWith({
      questions: [
        { property_key: "status", required: true },
        { property_key: "title", required: false },
      ],
      submission_permissions: "none",
    });
  });

  it("toggling Required in the question options popover PATCHes that entry's required flag", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    render(
      <FormView
        viewId="v1"
        properties={[TITLE_PROP]}
        config={{ questions: [{ property_key: "title", required: false }] }}
        onConfigChange={onConfigChange}
      />
    );

    await openQuestionOptions(user, 0);
    await user.click(screen.getByText("Required"));

    expect(onConfigChange).toHaveBeenCalledWith({
      questions: [{ property_key: "title", required: true }],
      submission_permissions: "none",
    });
  });

  it("toggling Description reveals an inline description field that commits on blur", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    const { rerender } = render(
      <FormView
        viewId="v1"
        properties={[TITLE_PROP]}
        config={{ questions: [{ property_key: "title", required: false }] }}
        onConfigChange={onConfigChange}
      />
    );

    await openQuestionOptions(user, 0);
    await user.click(screen.getByText("Description"));

    expect(onConfigChange).toHaveBeenCalledWith({
      questions: [{ property_key: "title", required: false, description: "" }],
      submission_permissions: "none",
    });

    // The card is controlled by `config` — re-render with the patched
    // config, same as a real parent's `onConfigChange` -> state -> new
    // `config` prop round-trip, before the now-revealed field can be found.
    rerender(
      <FormView
        viewId="v1"
        properties={[TITLE_PROP]}
        config={{ questions: [{ property_key: "title", required: false, description: "" }] }}
        onConfigChange={onConfigChange}
      />
    );

    const desc = screen.getByLabelText("Question 1 description");
    await user.type(desc, "Your legal name");
    desc.blur();

    await waitFor(() =>
      expect(onConfigChange).toHaveBeenLastCalledWith({
        questions: [{ property_key: "title", required: false, description: "Your legal name" }],
        submission_permissions: "none",
      })
    );
  });

  it("Long answer is only offered for text-like properties, and flips a preview to a textarea", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    render(
      <FormView
        viewId="v1"
        properties={[TITLE_PROP, STATUS_PROP]}
        config={{
          questions: [
            { property_key: "title", required: false },
            { property_key: "status", required: false },
          ],
        }}
        onConfigChange={onConfigChange}
      />
    );

    await openQuestionOptions(user, 0);
    expect(screen.getByText("Long answer")).toBeInTheDocument();
    await user.click(screen.getByText("Long answer"));
    expect(onConfigChange).toHaveBeenCalledWith({
      questions: [
        { property_key: "title", required: false, long_answer: true },
        { property_key: "status", required: false },
      ],
      submission_permissions: "none",
    });

    await openQuestionOptions(user, 1);
    expect(screen.queryByText("Long answer")).not.toBeInTheDocument();
  });

  it("Sync with property name off reveals an editable label input", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    const { rerender } = render(
      <FormView
        viewId="v1"
        properties={[TITLE_PROP]}
        config={{ questions: [{ property_key: "title", required: false }] }}
        onConfigChange={onConfigChange}
      />
    );

    await openQuestionOptions(user, 0);
    await user.click(screen.getByText("Sync with property name"));

    expect(onConfigChange).toHaveBeenCalledWith({
      questions: [{ property_key: "title", required: false, sync_with_name: false, label: "Title" }],
      submission_permissions: "none",
    });

    rerender(
      <FormView
        viewId="v1"
        properties={[TITLE_PROP]}
        config={{
          questions: [{ property_key: "title", required: false, sync_with_name: false, label: "Title" }],
        }}
        onConfigChange={onConfigChange}
      />
    );

    const label = screen.getByLabelText("Question 1 label");
    await user.clear(label);
    await user.type(label, "Your full legal name");
    label.blur();

    await waitFor(() =>
      expect(onConfigChange).toHaveBeenLastCalledWith({
        questions: [
          { property_key: "title", required: false, sync_with_name: false, label: "Your full legal name" },
        ],
        submission_permissions: "none",
      })
    );
  });

  it("renders a disabled radio preview per select option, with a working Add option", async () => {
    const user = userEvent.setup();
    const onPropertiesChanged = vi.fn();
    render(
      <FormView
        viewId="v1"
        properties={[SELECT_PROP]}
        config={{ questions: [{ property_key: "select", required: false }] }}
        onConfigChange={vi.fn()}
        onPropertiesChanged={onPropertiesChanged}
      />
    );

    const card = screen.getByTestId("question-card-0");
    expect(within(card).getByText("Alpha")).toBeInTheDocument();
    expect(within(card).getAllByRole("radio")).toHaveLength(1);

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    await user.click(within(card).getByText("Add option"));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/db/properties/select",
      expect.objectContaining({ method: "PATCH" })
    );
    await waitFor(() => expect(onPropertiesChanged).toHaveBeenCalled());
  });

  it("Question type is disabled and shows the property's current type", async () => {
    const user = userEvent.setup();
    render(
      <FormView
        viewId="v1"
        properties={[STATUS_PROP]}
        config={{ questions: [{ property_key: "status", required: false }] }}
        onConfigChange={vi.fn()}
      />
    );

    await openQuestionOptions(user, 0);
    const row = screen.getByText("Question type").closest('[role="option"]')!;
    expect(within(row as HTMLElement).getByText("Status")).toBeInTheDocument();
    expect(row).toHaveAttribute("aria-disabled", "true");
  });

  it("is_form_closed toggle PATCHes immediately", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    render(<FormView viewId="v1" properties={[TITLE_PROP]} config={{}} onConfigChange={onConfigChange} />);

    await user.click(screen.getByLabelText("Closed for submissions"));

    // Immediate — no debounce, no timer to advance (matches Board's/
    // TemplateEditor's own toggle convention).
    expect(onConfigChange).toHaveBeenCalledWith({
      is_form_closed: true,
      submission_permissions: "none",
    });
  });

  it("submit-screen button text edits debounce-PATCH config.submit_screen (600ms, not synchronous)", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    render(<FormView viewId="v1" properties={[TITLE_PROP]} config={{}} onConfigChange={onConfigChange} />);

    const input = screen.getByLabelText("Submit button text");
    await user.clear(input);
    await user.type(input, "Send it");

    expect(onConfigChange).not.toHaveBeenCalled();

    await waitFor(
      () =>
        expect(onConfigChange).toHaveBeenCalledWith({
          submit_screen: {
            button_text: "Send it",
            button_color: DEFAULT_BUTTON_COLOR,
            confirmation_title: "Thanks!",
            confirmation_body: "",
          },
          submission_permissions: "none",
        }),
      { timeout: 2000 }
    );
  });

  it("confirmation title/body edits debounce-PATCH the whole submit_screen shape", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    render(
      <FormView
        viewId="v1"
        properties={[TITLE_PROP]}
        config={{
          submit_screen: { button_text: "Go", button_color: "#000000", confirmation_title: "Thanks!", confirmation_body: "" },
        }}
        onConfigChange={onConfigChange}
      />
    );

    const input = screen.getByLabelText("Confirmation body");
    await user.type(input, "We got it.");

    await waitFor(
      () =>
        expect(onConfigChange).toHaveBeenCalledWith({
          submit_screen: {
            button_text: "Go",
            button_color: "#000000",
            confirmation_title: "Thanks!",
            confirmation_body: "We got it.",
          },
          submission_permissions: "none",
        }),
      { timeout: 2000 }
    );
  });

  it("submission_permissions is always written as 'none' regardless of which control triggered the save", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    render(
      <FormView viewId="v1" properties={[TITLE_PROP, STATUS_PROP]} config={{}} onConfigChange={onConfigChange} />
    );

    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.click(screen.getByText("Title"));
    await user.click(screen.getByLabelText("Closed for submissions"));

    expect(onConfigChange).toHaveBeenCalledTimes(2);
    for (const call of onConfigChange.mock.calls) {
      expect((call[0] as Record<string, unknown>).submission_permissions).toBe("none");
    }
  });

  it("does not render any submission-permissions picker offering a value other than none", () => {
    render(<FormView viewId="v1" properties={[TITLE_PROP]} config={{}} onConfigChange={vi.fn()} />);

    // Treatment (a) from task-44-brief.md, re-confirmed by this session's
    // own live capture of Notion's richer picker: no working control offers
    // any value but "none".
    expect(screen.queryByText(/comment_only/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/read_and_write/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /access to submission/i })).not.toBeInTheDocument();
  });

  it("the copy-link button produces the correct /forms/{viewId} URL", async () => {
    const user = userEvent.setup();
    // `userEvent.setup()` installs its own in-memory clipboard stub on the
    // window (`writeToClipboard: true` by default — see
    // Clipboard.attachClipboardStubToView) *after* this call, replacing
    // whatever `navigator.clipboard` pointed to before — so the spy has to
    // be attached after `setup()`, not before it, or it gets clobbered.
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<FormView viewId="abc-123" properties={[]} config={{}} onConfigChange={vi.fn()} />);

    expect(screen.getByLabelText("Form link")).toHaveValue(`${window.location.origin}/forms/abc-123`);

    await user.click(screen.getByRole("button", { name: /copy link/i }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/forms/abc-123`);
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("renders the closed-form badge only when is_form_closed is true", () => {
    const { rerender } = render(
      <FormView viewId="v1" properties={[]} config={{ is_form_closed: false }} onConfigChange={vi.fn()} />
    );
    expect(screen.queryByTestId("form-closed-badge")).not.toBeInTheDocument();

    rerender(<FormView viewId="v1" properties={[]} config={{ is_form_closed: true }} onConfigChange={vi.fn()} />);
    expect(screen.getByTestId("form-closed-badge")).toBeInTheDocument();
    expect(screen.getByText(/closed — not accepting responses/i)).toBeInTheDocument();
  });
});
