import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TitleCell } from "./TitleCell";
import { TextCell } from "./TextCell";
import { NumberCell } from "./NumberCell";
import { SelectCell } from "./SelectCell";
import { MultiSelectCell } from "./MultiSelectCell";
import { StatusCell } from "./StatusCell";
import { DateCell } from "./DateCell";
import { CheckboxCell } from "./CheckboxCell";
import { GenericCell } from "./GenericCell";
import { RelationCell } from "./RelationCell";
import type { PropertyResponse, RelatedRow } from "@/lib/database/types";

describe("TitleCell", () => {
  it("renders read-only, with no input, when not editable", () => {
    render(<TitleCell value={{ type: "title", title: "My Note" }} editable={false} onChange={vi.fn()} />);
    expect(screen.getByText("My Note")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("commits an edited value via onChange when editable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TitleCell value={{ type: "title", title: "Old" }} editable={true} onChange={onChange} />);

    await user.click(screen.getByText("Old"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "New Title{Enter}");

    expect(onChange).toHaveBeenCalledWith({ type: "title", title: "New Title" });
  });
});

describe("TextCell", () => {
  it("renders read-only text with no input when not editable", () => {
    render(<TextCell value={{ type: "rich_text", rich_text: "hello" }} editable={false} onChange={vi.fn()} />);
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("commits an edited value via onChange when editable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextCell value={{ type: "rich_text", rich_text: "hello" }} editable={true} onChange={onChange} />);

    await user.click(screen.getByText("hello"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "world{Enter}");

    expect(onChange).toHaveBeenCalledWith({ type: "rich_text", rich_text: "world" });
  });
});

describe("NumberCell", () => {
  it("renders read-only when not editable", () => {
    render(<NumberCell value={{ type: "number", number: 42 }} editable={false} onChange={vi.fn()} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("commits a numeric value via onChange when editable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberCell value={{ type: "number", number: 1 }} editable={true} onChange={onChange} />);

    await user.click(screen.getByText("1"));
    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "99{Enter}");

    expect(onChange).toHaveBeenCalledWith({ type: "number", number: 99 });
  });

  it("clears to null when the input is emptied", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberCell value={{ type: "number", number: 1 }} editable={true} onChange={onChange} />);

    await user.click(screen.getByText("1"));
    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith({ type: "number", number: null });
  });
});

describe("SelectCell", () => {
  it("renders a read-only pill with no input when not editable", () => {
    render(<SelectCell value={{ type: "select", select: "article" }} editable={false} onChange={vi.fn()} />);
    expect(screen.getByText("article")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("commits a new value via onChange when editable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SelectCell value={{ type: "select", select: "article" }} editable={true} onChange={onChange} />);

    await user.click(screen.getByText("article"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "video{Enter}");

    expect(onChange).toHaveBeenCalledWith({ type: "select", select: "video" });
  });
});

describe("MultiSelectCell", () => {
  it("renders read-only pills with no input when not editable", () => {
    render(
      <MultiSelectCell
        value={{ type: "multi_select", multi_select: ["rust", "async"] }}
        editable={false}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("rust")).toBeInTheDocument();
    expect(screen.getByText("async")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("parses a comma-separated edit into an array via onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MultiSelectCell
        value={{ type: "multi_select", multi_select: ["rust"] }}
        editable={true}
        onChange={onChange}
      />
    );

    await user.click(screen.getByText("rust"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "rust, async, tokio{Enter}");

    expect(onChange).toHaveBeenCalledWith({
      type: "multi_select",
      multi_select: ["rust", "async", "tokio"],
    });
  });
});

describe("StatusCell", () => {
  it("renders a read-only pill with no input when not editable", () => {
    render(<StatusCell value={{ type: "status", status: "learning" }} editable={false} onChange={vi.fn()} />);
    expect(screen.getByText("learning")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("commits a new status via onChange when editable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatusCell value={{ type: "status", status: "learning" }} editable={true} onChange={onChange} />);

    await user.click(screen.getByText("learning"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "mastered{Enter}");

    expect(onChange).toHaveBeenCalledWith({ type: "status", status: "mastered" });
  });
});

describe("DateCell", () => {
  it("renders a formatted read-only date with no input when not editable", () => {
    render(
      <DateCell
        value={{ type: "date", date: { start: "2026-08-08", end: null, time_zone: null } }}
        editable={false}
        onChange={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("Date")).not.toBeInTheDocument();
    // Formatted via toLocaleDateString, not the raw ISO string.
    expect(screen.queryByText("2026-08-08")).not.toBeInTheDocument();
    expect(screen.getByText(new Date("2026-08-08").toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
    }))).toBeInTheDocument();
  });

  it("commits an edited date via onChange when editable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DateCell
        value={{ type: "date", date: { start: "2026-08-08", end: null, time_zone: null } }}
        editable={true}
        onChange={onChange}
      />
    );

    await user.click(screen.getByRole("button"));
    const input = screen.getByLabelText("Date");
    await user.clear(input);
    await user.type(input, "2026-09-01");
    input.blur();

    expect(onChange).toHaveBeenCalledWith({
      type: "date",
      date: { start: "2026-09-01", end: null, time_zone: null },
    });
  });
});

describe("CheckboxCell", () => {
  it("is disabled (not togglable) when not editable", () => {
    render(<CheckboxCell value={{ type: "checkbox", checkbox: true }} editable={false} onChange={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox).toBeDisabled();
    expect(checkbox.checked).toBe(true);
  });

  it("toggles via onChange when editable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CheckboxCell value={{ type: "checkbox", checkbox: false }} editable={true} onChange={onChange} />);

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeDisabled();
    await user.click(checkbox);

    expect(onChange).toHaveBeenCalledWith({ type: "checkbox", checkbox: true });
  });
});

describe("GenericCell", () => {
  it("renders an em-dash for an absent value", () => {
    render(<GenericCell value={undefined} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders a plain string for an unknown type's inner value (e.g. url)", () => {
    render(<GenericCell value={{ type: "url", url: "https://example.com" }} />);
    expect(screen.getByText("https://example.com")).toBeInTheDocument();
  });

  it("JSON-stringifies a non-string inner value rather than crashing", () => {
    render(<GenericCell value={{ type: "weird", weird: { a: 1 } }} />);
    expect(screen.getByText('{"a":1}')).toBeInTheDocument();
  });
});

function relationProperty(overrides: Partial<PropertyResponse> = {}): PropertyResponse {
  return {
    id: "p-rel",
    data_source_id: "ds-1",
    user_id: "user-1",
    key: "related",
    name: "Related",
    type: "relation",
    config: { relation_id: "rel-1", side: "forward", target_data_source_id: "ds-2" },
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

const LINKED: RelatedRow[] = [
  { id: "row-a", title: "Alpha" },
  { id: "row-b", title: "Beta" },
];

describe("RelationCell", () => {
  it("calls onEnsureLoaded once on mount", () => {
    const onEnsureLoaded = vi.fn();
    render(
      <RelationCell
        property={relationProperty()}
        editable={false}
        links={undefined}
        onEnsureLoaded={onEnsureLoaded}
        onLinksChange={vi.fn()}
      />
    );
    expect(onEnsureLoaded).toHaveBeenCalledTimes(1);
  });

  it("renders chips with titles, not bare ids", () => {
    render(
      <RelationCell
        property={relationProperty()}
        editable={false}
        links={LINKED}
        onEnsureLoaded={vi.fn()}
        onLinksChange={vi.fn()}
      />
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("row-a")).not.toBeInTheDocument();
  });

  it("read-only: no '×' remove buttons and no '+' link button at all (not merely disabled)", () => {
    render(
      <RelationCell
        property={relationProperty()}
        editable={false}
        links={LINKED}
        onEnsureLoaded={vi.fn()}
        onLinksChange={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /link a row/i })).not.toBeInTheDocument();
  });

  it("editable: each chip has a '×' that removes just that link via onLinksChange", async () => {
    const user = userEvent.setup();
    const onLinksChange = vi.fn();
    render(
      <RelationCell
        property={relationProperty()}
        editable={true}
        links={LINKED}
        onEnsureLoaded={vi.fn()}
        onLinksChange={onLinksChange}
      />
    );

    await user.click(screen.getByRole("button", { name: "Remove Alpha" }));
    expect(onLinksChange).toHaveBeenCalledWith([{ id: "row-b", title: "Beta" }]);
  });

  it("editable: '+' opens the RelationPicker", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ rows: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    render(
      <RelationCell
        property={relationProperty()}
        editable={true}
        links={LINKED}
        onEnsureLoaded={vi.fn()}
        onLinksChange={vi.fn()}
      />
    );

    expect(screen.queryByRole("dialog", { name: /link rows/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Link a row" }));
    expect(screen.getByRole("dialog", { name: /link rows/i })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("shows a loading placeholder (not '—') while links is undefined", () => {
    render(
      <RelationCell
        property={relationProperty()}
        editable={false}
        links={undefined}
        onEnsureLoaded={vi.fn()}
        onLinksChange={vi.fn()}
      />
    );
    expect(screen.getByText("…")).toBeInTheDocument();
  });

  it("shows an em-dash once loaded with zero links", () => {
    render(
      <RelationCell
        property={relationProperty()}
        editable={false}
        links={[]}
        onEnsureLoaded={vi.fn()}
        onLinksChange={vi.fn()}
      />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
