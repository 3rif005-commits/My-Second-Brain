// Per-column view state: visibility, wrap, calculation, order.
//
// All of it lives in `db_views.config`, which is an unvalidated JSONB
// pass-through (`ViewUpdate`). That is deliberate and it is also what Notion
// does — property order, visibility and width are PER VIEW there, which is why
// the "Property visibility" panel is where you reorder columns. So none of
// this needs a backend change, and none of it belongs on
// `db_properties.position`: the same property can be third in one view and
// hidden in another.
//
// WRITERS RETURN A PATCH, not a whole config. `DatabaseShell.patchViewConfig`
// merges `{...latest, ...patch}` onto the freshest known config and chains
// same-view writes, which is what fixed a real bug where two rapid config
// changes each read the same stale render-time config and the second silently
// dropped the first. Handing that merger a FULL config would defeat it: the
// full object would overwrite keys a concurrent write had just set.
//
// Readers are tolerant by design. A view's config is written by several
// surfaces (M1's header menu, M3's settings sidebar, M11's drag-resize) and
// read by all of them, so an absent or malformed key must degrade to the
// default rather than throw.
import type { PropertyResponse, ViewResponse } from "./types";

/** Keys hidden in this view. Absent means "nothing hidden". */
export function getHiddenKeys(config: Record<string, unknown>): string[] {
  const raw = config.hidden_properties;
  return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : [];
}

export function isHidden(config: Record<string, unknown>, key: string): boolean {
  return getHiddenKeys(config).includes(key);
}

export function patchHidden(
  config: Record<string, unknown>,
  key: string,
  hidden: boolean
): Record<string, unknown> {
  const current = getHiddenKeys(config).filter((k) => k !== key);
  return { hidden_properties: hidden ? [...current, key] : current };
}

/** Content wrapping, per column.
 *
 * Defaults to TRUE because Notion's header menu offers "Unwrap content" on a
 * fresh column — the label names the ACTION, so the current state is wrapped.
 * Rendering a static "Wrap" label would be wrong in both directions. */
export function isWrapped(config: Record<string, unknown>, key: string): boolean {
  const raw = config.wrapped_properties;
  if (raw && typeof raw === "object" && key in (raw as Record<string, unknown>)) {
    return Boolean((raw as Record<string, boolean>)[key]);
  }
  return true;
}

export function patchWrapped(
  config: Record<string, unknown>,
  key: string,
  wrapped: boolean
): Record<string, unknown> {
  const raw = (config.wrapped_properties ?? {}) as Record<string, boolean>;
  return { wrapped_properties: { ...raw, [key]: wrapped } };
}

/** The column footer's calculation, per column. `undefined` = none. */
export function getCalculation(
  config: Record<string, unknown>,
  key: string
): string | undefined {
  const raw = config.calculations;
  if (!raw || typeof raw !== "object") return undefined;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export function patchCalculation(
  config: Record<string, unknown>,
  key: string,
  aggregator: string | undefined
): Record<string, unknown> {
  const raw = { ...((config.calculations ?? {}) as Record<string, string>) };
  if (aggregator) raw[key] = aggregator;
  else delete raw[key];
  return { calculations: raw };
}

/** Column order for this view. Falls back to schema `position` order for any
 * property the config does not mention, so adding a property never leaves it
 * unrendered. */
export function orderProperties(
  properties: PropertyResponse[],
  config: Record<string, unknown>
): PropertyResponse[] {
  const byPosition = [...properties].sort((a, b) => a.position - b.position);
  const raw = config.property_order;
  if (!Array.isArray(raw)) return byPosition;

  const order = raw.filter((k): k is string => typeof k === "string");
  const indexOf = (p: PropertyResponse) => {
    const i = order.indexOf(p.key);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return byPosition.sort((a, b) => indexOf(a) - indexOf(b));
}

/** Insert `key` immediately before or after `anchorKey` in this view's order.
 *
 * Writes an EXPLICIT full order, including properties that were previously
 * implicit, because a partial order plus a position fallback cannot express
 * "third, regardless of when it was created". */
export function patchInsertedNear(
  config: Record<string, unknown>,
  properties: PropertyResponse[],
  key: string,
  anchorKey: string,
  side: "left" | "right"
): Record<string, unknown> {
  const current = orderProperties(properties, config)
    .map((p) => p.key)
    .filter((k) => k !== key);
  const at = current.indexOf(anchorKey);
  const insertAt = at === -1 ? current.length : side === "left" ? at : at + 1;
  current.splice(insertAt, 0, key);
  return { property_order: current };
}

/** The view's config, or an empty object. Views are sometimes null while a
 * database is still loading. */
export function configOf(view: ViewResponse | null | undefined): Record<string, unknown> {
  return view?.config ?? {};
}
