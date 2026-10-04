// Routing UI: where an answer ran, the privacy prompt, and what a mode sends.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PrivacyPrompt, RouteBadge } from "./RouteBadge";
import { modeRequest } from "./ModeToggle";

describe("RouteBadge", () => {
  it("says a local answer stayed on the device", () => {
    render(<RouteBadge route={{ slot: "local", on_device: true, decided_by: "rule", reason: "message mentions bank" }} />);
    expect(screen.getByRole("button").textContent).toContain("stayed on this device");
  });

  it("names the cloud model and counts what was held back", () => {
    render(<RouteBadge route={{ slot: "fast", model: "claude-haiku-4-5", on_device: false,
      withheld: [{ id: "p1", title: "Health log" }] }} />);
    const b = screen.getByRole("button");
    expect(b.textContent).toContain("claude-haiku-4-5");
    expect(b.textContent).toContain("1 private held back");
    fireEvent.click(b);
    expect(screen.getByRole("dialog").textContent).toContain("Health log");
  });

  it("offers to ask again on the other slots", () => {
    const rerun = vi.fn();
    render(<RouteBadge route={{ slot: "fast", on_device: false }} onRerun={rerun} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("button", { name: "Fast" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Strong" }));
    expect(rerun).toHaveBeenCalledWith("strong");
  });
});

describe("PrivacyPrompt", () => {
  const props = { withheld: [{ id: "p1", title: "Bank notes" }, { id: "p2", title: "Health" }],
    slot: "fast", model: "m" };

  it("lists the notes and offers three choices", () => {
    const onLocal = vi.fn(), onWithout = vi.fn(), onOnce = vi.fn();
    render(<PrivacyPrompt {...props} onLocal={onLocal} onWithout={onWithout} onOnce={onOnce} />);
    expect(screen.getByText(/2 private notes/)).toBeTruthy();
    expect(screen.getByText("Bank notes")).toBeTruthy();
    expect(screen.getByText(/Nothing has been sent/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /answer on device/i }));
    fireEvent.click(screen.getByRole("button", { name: /send without them/i }));
    fireEvent.click(screen.getByRole("button", { name: /send them this once/i }));
    expect([onLocal, onWithout, onOnce].every((f) => f.mock.calls.length === 1)).toBe(true);
  });

  it("shows the outcome instead of the buttons once chosen", () => {
    render(<PrivacyPrompt {...props} resolved="Answered on this device."
      onLocal={() => {}} onWithout={() => {}} onOnce={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Answered on this device.")).toBeTruthy();
  });
});

describe("modeRequest", () => {
  it("maps each mode to the request fields", () => {
    expect(modeRequest("auto")).toEqual({ mode: "auto" });
    expect(modeRequest("local")).toEqual({ mode: "local" });
    expect(modeRequest("strong")).toEqual({ mode: "auto", slot: "strong" });
  });
});

describe("a rule from an answer", () => {
  it("saves 'messages mentioning … → slot' at the top of the rules", async () => {
    const { waitFor } = await import("@testing-library/react");
    const policy = { slots: {}, rules: [{ id: "big-context", enabled: true, kind: "context_over", value: 30000, use: "long" }],
      default_slot: "fast", instructions: "", privacy: { untrusted: [], when_private_needed: "ask" },
      brain: { kind: "rules_only", timeout_ms: 2500, provider: "" } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ policy })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 4, policy })));
    vi.stubGlobal("fetch", fetchMock);
    render(<RouteBadge route={{ slot: "fast", on_device: false }} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByLabelText("Words"), { target: { value: "proof" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getByText("Rule added (v4).")).toBeTruthy());
    const saved = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(saved.policy.rules[0]).toMatchObject({ kind: "message_matches", value: "proof", use: "strong" });
    expect(saved.policy.rules[1].id).toBe("big-context");
    vi.unstubAllGlobals();
  });
});
