"use client";

// Pages publish themselves to plugins with one call. The handle is created
// once per page (keyed by id) so plugins are not re-notified on every render;
// `current()` and the actions always read the latest render through refs, and
// `subscribe` listeners fire when `state` changes identity — callers pass a
// memoised state object, so that means "something a plugin can see changed".
import { useEffect, useRef } from "react";
import type { DatabaseHandle, DatabaseState, LiveHandle, NoteHandle, NoteState } from "./api";
import { Channel, databases, notes } from "./host";

type Actions<H, S> = Omit<H, keyof LiveHandle<S>>;

function usePublish<S, H extends LiveHandle<S>>(
  channel: Channel<H>,
  key: string | null,
  state: S,
  actions: Actions<H, S>,
) {
  const stateRef = useRef(state);
  const actionsRef = useRef(actions);
  const listeners = useRef(new Set<() => void>());
  actionsRef.current = actions;

  useEffect(() => {
    if (stateRef.current === state) return;
    stateRef.current = state;
    for (const l of [...listeners.current]) {
      try {
        l();
      } catch (e) {
        console.error("[plugins] listener threw", e);
      }
    }
  }, [state]);

  useEffect(() => {
    if (!key) return;
    const live: LiveHandle<S> = {
      current: () => stateRef.current,
      subscribe: (l) => {
        listeners.current.add(l);
        return () => {
          listeners.current.delete(l);
        };
      },
    };
    // Each action forwards to the latest render's implementation.
    const forwarded = Object.fromEntries(
      Object.keys(actionsRef.current as object).map((name) => [
        name,
        (...args: unknown[]) =>
          (actionsRef.current as Record<string, (...a: unknown[]) => unknown>)[name](...args),
      ]),
    );
    const subs = listeners.current;
    const unpublish = channel.publish(key, { ...forwarded, ...live } as H);
    return () => {
      unpublish();
      subs.clear();
    };
    // Only the page's identity re-publishes; state and actions flow through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, key]);
}

export function usePublishNote(state: NoteState | null, actions: Actions<NoteHandle, NoteState>) {
  usePublish(notes, state ? `note:${state.id}` : null, state as NoteState, actions);
}

export function usePublishDatabase(
  key: string | null,
  state: DatabaseState | null,
  actions: Actions<DatabaseHandle, DatabaseState>,
) {
  usePublish(databases, state ? key : null, state as DatabaseState, actions);
}
