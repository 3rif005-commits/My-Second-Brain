"use client";

import type { PlanItem } from "@/lib/notion";
import { FIDELITY_LABEL } from "@/lib/notion";

const STYLE: Record<PlanItem["fidelity"], string> = {
  exact: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  approximated: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  lossy: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

/** Exact / Approximated / Lossy, with the count of losses when there are any. */
export function FidelityPill({ fidelity, losses }: { fidelity: PlanItem["fidelity"]; losses: number }) {
  return (
    <span data-testid="fidelity-pill"
      className={`inline-flex items-center h-5 px-2 rounded-full text-[11px] font-medium ${STYLE[fidelity]}`}>
      {losses > 0 ? `${losses} ${fidelity === "lossy" ? "lossy" : "approximated"}` : FIDELITY_LABEL[fidelity]}
    </span>
  );
}
