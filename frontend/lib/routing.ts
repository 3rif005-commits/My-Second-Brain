// Settings → Routing: the policy document and the calls behind the page.
// The backend (services/routing) owns validation; this mirrors its shape.

export const SLOTS = ["local", "fast", "strong", "vision", "long"] as const;
export type Slot = (typeof SLOTS)[number];

export type RuleKind = "message_matches" | "context_over" | "surface_is" | "spend_today_over" | "always";

export interface Rule {
  id: string;
  enabled: boolean;
  kind: RuleKind;
  value: string | number | null;
  /** A slot, or "brain" to let the brain decide. */
  use: Slot | "brain";
}

export interface Policy {
  slots: Record<Slot, { provider: string; model: string }>;
  rules: Rule[];
  default_slot: Slot;
  instructions: string;
  privacy: { untrusted: string[]; when_private_needed: "ask" | "local" | "drop" };
  brain: { kind: "rules_only" | "local" | "cloud"; timeout_ms: number; provider: string };
}

export interface PolicyResponse {
  policy: Policy;
  default: Policy;
  slots: Slot[];
  slot_help: Record<Slot, string>;
  rule_kinds: Record<RuleKind, string>;
}

export interface TargetProvider {
  key: string;
  label: string;
  provider: string;
  model: string;
  capabilities: string[];
  has_key: boolean;
  trusted: boolean;
  ceiling: "open" | "personal" | "private";
}

export interface Targets {
  providers: TargetProvider[];
  slots: { slot: Slot; label: string | null; model: string | null; error: string | null }[];
}

export interface TestResult {
  slot: Slot;
  provider: string;
  model: string;
  decided_by: string;
  reason: string;
  rule_id: string | null;
  confidence: number | null;
  brain_ms: number;
  total_ms: number;
  ceiling: string;
  on_device: boolean;
  notes: string[];
}

export interface Decision {
  id: string;
  created_at: string;
  surface: string;
  slot: string;
  provider: string | null;
  model: string | null;
  decided_by: string;
  reason: string;
  latency_ms: number | null;
  sent_count: number;
  withheld_count: number;
  released_count: number;
  override_of: string | null;
}

export interface DecisionLog {
  rows: Decision[];
  summary: { count: number; local_pct: number; override_pct: number; withheld: number;
             by_slot: Record<string, number> };
}

export const SLOT_NAME: Record<Slot, string> = {
  local: "Local", fast: "Fast", strong: "Strong", vision: "Vision", long: "Long",
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/ws/routing${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.detail ?? body?.error;
    throw new Error(typeof detail === "string" ? detail : detail?.error ?? `Server ${res.status}`);
  }
  return body as T;
}

export const routingApi = {
  policy: () => call<PolicyResponse>("/policy"),
  save: (policy: Policy, note = "") =>
    call<{ version: number; policy: Policy }>("/policy", { method: "PUT", body: JSON.stringify({ policy, note }) }),
  versions: () => call<{ version: number; note: string; created_at: string }[]>("/policy/versions"),
  restore: (version: number | null) =>
    call<{ version: number; policy: Policy }>("/policy/restore", { method: "POST", body: JSON.stringify({ version }) }),
  targets: () => call<Targets>("/targets"),
  test: (query: string, policy: Policy, slot?: string) =>
    call<TestResult>("/test", { method: "POST", body: JSON.stringify({ query, policy, slot }) }),
  ping: (slot: Slot) =>
    call<{ ok: boolean; ms?: number; error?: string; label?: string; model?: string }>(`/ping/${slot}`, { method: "POST" }),
  decisions: (q: { slot?: string; decided_by?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return call<DecisionLog>(`/decisions${qs.size ? `?${qs}` : ""}`);
  },
};

/** "Always send messages mentioning … to …", from an answer's route popover.
 *  Goes first, so it beats the rules already there; saved as a new version. */
export async function addWordRule(words: string, slot: Slot): Promise<number> {
  const { policy } = await routingApi.policy();
  let n = 1;
  while (policy.rules.some((r) => r.id === `from-chat-${n}`)) n += 1;
  const rule: Rule = { id: `from-chat-${n}`, enabled: true, kind: "message_matches",
    value: words, use: slot };
  const saved = await routingApi.save({ ...policy, rules: [rule, ...policy.rules] },
    `Rule from chat: ${words} → ${SLOT_NAME[slot]}`);
  return saved.version;
}
