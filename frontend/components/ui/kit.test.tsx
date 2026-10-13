import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Checkbox, ConfirmDialog, Select, Tabs, Tag, Toggle } from "./index";

describe("Toggle", () => {
  it("is a switch that reports the flipped value", async () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Small text" />);
    const sw = screen.getByRole("switch", { name: "Small text" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Checkbox", () => {
  it("keeps a real checkbox for forms and screen readers", async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Approved" />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Approved" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Select", () => {
  const options = [
    { value: "system", label: "Use system setting" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  it("shows the current option and picks another from the menu", async () => {
    const onChange = vi.fn();
    render(<Select label="Theme" value="light" options={options} onChange={onChange} />);
    const button = screen.getByRole("button", { name: "Theme" });
    expect(button).toHaveTextContent("Light");
    await userEvent.click(button);
    const selected = screen.getByRole("option", { name: "Light" });
    expect(selected).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("option", { name: "Dark" }));
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("moves between options with the arrow keys", async () => {
    render(<Select label="Theme" value="system" options={options} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Theme" }));
    const listbox = screen.getByRole("listbox");
    screen.getByRole("option", { name: "Use system setting" }).focus();
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Light" })).toHaveFocus();
    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: "Dark" })).toHaveFocus();
  });
});

describe("Tag", () => {
  it("uses the measured option palette and falls back to default for unknown colours", () => {
    const { rerender } = render(<Tag color="blue">Design</Tag>);
    expect(screen.getByText("Design").parentElement).toHaveStyle({ background: "var(--opt-blue-bg)" });
    rerender(<Tag color="teal">Design</Tag>);
    expect(screen.getByText("Design").parentElement).toHaveStyle({ background: "var(--opt-default-bg)" });
  });
});

describe("Tabs", () => {
  it("marks the active tab and reports clicks", async () => {
    const onChange = vi.fn();
    render(
      <Tabs label="Views" value="a" onChange={onChange} items={[{ value: "a", label: "Table" }, { value: "b", label: "Board" }]} />,
    );
    expect(screen.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "Board" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("ConfirmDialog", () => {
  it("confirms, cancels, and closes on Escape", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Delete property?" confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole("dialog", { name: "Delete property?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("renders nothing while closed", () => {
    render(<ConfirmDialog open={false} title="x" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
