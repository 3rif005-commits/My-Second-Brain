#!/usr/bin/env python3
"""
Milestone 0 storage-layout benchmark for the Notion-databases spec.

Answers the question research §K.8 #5 / §L.1 #12 found unanswered in public
benchmarks: how does `ORDER BY` on a JSONB-extracted key perform against a
real physical column, at realistic row counts, for this product's actual
view-load query shape:

    WHERE <property> = ?  ORDER BY <other property>  LIMIT 50  [OFFSET n]

and a filtered `COUNT(*)`.

Three table layouts are generated with IDENTICAL data and compared:

  - bench_jsonb_unindexed : shaped like spec §3.2's `db_row_props`
                             (id, properties jsonb) + GIN(jsonb_path_ops) only.
  - bench_jsonb_indexed   : same, PLUS B-tree expression indexes on the two
                             "hot" properties the compiler would index via a
                             migration (spec §4's mitigation) — one on the
                             equality (select) property, one on the sort
                             (number) property, and one composite matching
                             this exact query shape.
  - bench_physical        : comparison baseline only (not a candidate the
                             design adopts) — real `f_<key>` typed columns
                             with ordinary B-tree indexes, per spec §4.3's
                             documented "escape hatch" shape.

20 properties (5 number, 7 rich_text, 3 select, 3 date, 2 checkbox) are
generated per row, matching the spec's property-value encoding (§3.3) at a
representative-but-simplified level (rich_text values here are plain
strings, not full mark-up spans — irrelevant to storage/index performance).

Usage:
    cd backend && .venv/bin/python ../scripts/bench/storage_bench.py --rows 10000,50000
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
import statistics
import time
import uuid
from datetime import date, timedelta

import asyncpg

DSN = "postgresql://postgres:pw@localhost:55432/postgres"

# --------------------------------------------------------------------------
# Property schema: 20 properties, mixed types (spec §3.3 value shapes).
# Keys are meant to stand in for the spec's 8-char opaque `db_properties.key`
# (§4.2); named mnemonically here purely for this script's readability.
# --------------------------------------------------------------------------
NUMBER_KEYS = ["numAmt01", "numQty02", "numScr03", "numPri04", "numWt005"]
TEXT_KEYS = ["txtTitl1", "txtDesc2", "txtNote3", "txtTag04", "txtAuth5", "txtSrc06", "txtRef07"]
SELECT_KEYS = ["selStat1", "selCat02", "selPri03"]
DATE_KEYS = ["dtCreat1", "dtDue002", "dtRevw03"]
CHECKBOX_KEYS = ["chkDone1", "chkFlag2"]

ALL_KEYS = NUMBER_KEYS + TEXT_KEYS + SELECT_KEYS + DATE_KEYS + CHECKBOX_KEYS
assert len(ALL_KEYS) == 20, f"expected 20 properties, got {len(ALL_KEYS)}"

SELECT_OPTIONS = {
    "selStat1": ["backlog", "in_progress", "blocked", "done"],
    "selCat02": ["research", "engineering", "design", "ops"],
    "selPri03": ["low", "medium", "high"],
}

# The query under test: WHERE HOT_SELECT = ?  ORDER BY HOT_NUMBER  LIMIT 50.
# These are the "hot" properties a migration would add expression indexes for
# (spec §4's mitigation table: "B-tree expression indexes per hot property").
HOT_SELECT = "selStat1"
HOT_NUMBER = "numPri04"

RNG_SEED = 42
ITERATIONS_PER_SHAPE = 40  # timed executions per (table, query-shape) pair


def physical_column(key: str) -> str:
    return f"f_{key.lower()}"


def make_properties(rng: random.Random) -> dict:
    """Build one row's `properties` JSONB value, spec §3.3 shape."""
    props = {}
    for k in NUMBER_KEYS:
        props[k] = {"type": "number", "number": round(rng.uniform(0, 10_000), 2)}
    for k in TEXT_KEYS:
        length = rng.randint(20, 180)
        text = "".join(rng.choices("abcdefghijklmnopqrstuvwxyz ", k=length))
        props[k] = {"type": "rich_text", "rich_text": text}
    for k in SELECT_KEYS:
        props[k] = {"type": "select", "select": rng.choice(SELECT_OPTIONS[k])}
    for k in DATE_KEYS:
        d = date(2024, 1, 1) + timedelta(days=rng.randint(0, 900))
        props[k] = {"type": "date", "date": {"start": d.isoformat(), "end": None, "time_zone": None}}
    for k in CHECKBOX_KEYS:
        props[k] = {"type": "checkbox", "checkbox": rng.random() < 0.5}
    return props


def properties_to_physical_values(props: dict) -> list:
    """Flatten a properties dict into the ordered scalar list for the physical table."""
    values = []
    for k in NUMBER_KEYS:
        values.append(props[k]["number"])
    for k in TEXT_KEYS:
        values.append(props[k]["rich_text"])
    for k in SELECT_KEYS:
        values.append(props[k]["select"])
    for k in DATE_KEYS:
        values.append(date.fromisoformat(props[k]["date"]["start"]))
    for k in CHECKBOX_KEYS:
        values.append(props[k]["checkbox"])
    return values


# --------------------------------------------------------------------------
# DDL
# --------------------------------------------------------------------------

async def setup_schema(conn: asyncpg.Connection) -> None:
    await conn.execute(
        """
        DROP TABLE IF EXISTS bench_jsonb_unindexed;
        DROP TABLE IF EXISTS bench_jsonb_indexed;
        DROP TABLE IF EXISTS bench_physical;

        -- Layout 1: JSONB companion table shaped like spec §3.2 db_row_props,
        -- WITHOUT expression indexes (GIN only).
        CREATE TABLE bench_jsonb_unindexed (
          id         UUID PRIMARY KEY,
          properties JSONB NOT NULL DEFAULT '{}'
        );
        CREATE INDEX bench_jsonb_unindexed_gin
          ON bench_jsonb_unindexed USING gin (properties jsonb_path_ops);

        -- Layout 2: identical shape, WITH B-tree expression indexes on the
        -- two hot properties (what a migration would add per spec §4).
        CREATE TABLE bench_jsonb_indexed (
          id         UUID PRIMARY KEY,
          properties JSONB NOT NULL DEFAULT '{}'
        );
        CREATE INDEX bench_jsonb_indexed_gin
          ON bench_jsonb_indexed USING gin (properties jsonb_path_ops);
        """
    )
    # Expression indexes: text must match the query's expressions verbatim
    # for the planner to recognise them.
    await conn.execute(
        f"""
        CREATE INDEX bench_jsonb_indexed_hotsel
          ON bench_jsonb_indexed ((properties->'{HOT_SELECT}'->>'select'));
        CREATE INDEX bench_jsonb_indexed_hotnum
          ON bench_jsonb_indexed ((((properties->'{HOT_NUMBER}'->>'number'))::double precision));
        CREATE INDEX bench_jsonb_indexed_composite
          ON bench_jsonb_indexed (
            (properties->'{HOT_SELECT}'->>'select'),
            (((properties->'{HOT_NUMBER}'->>'number'))::double precision)
          );
        """
    )

    # Layout 3: physical comparison baseline, f_<key> typed columns.
    col_defs = []
    for k in NUMBER_KEYS:
        col_defs.append(f"{physical_column(k)} DOUBLE PRECISION")
    for k in TEXT_KEYS:
        col_defs.append(f"{physical_column(k)} TEXT")
    for k in SELECT_KEYS:
        col_defs.append(f"{physical_column(k)} TEXT")
    for k in DATE_KEYS:
        col_defs.append(f"{physical_column(k)} DATE")
    for k in CHECKBOX_KEYS:
        col_defs.append(f"{physical_column(k)} BOOLEAN")
    cols_sql = ",\n          ".join(col_defs)

    await conn.execute(
        f"""
        CREATE TABLE bench_physical (
          id UUID PRIMARY KEY,
          {cols_sql}
        );
        CREATE INDEX bench_physical_hotsel ON bench_physical ({physical_column(HOT_SELECT)});
        CREATE INDEX bench_physical_hotnum ON bench_physical ({physical_column(HOT_NUMBER)});
        CREATE INDEX bench_physical_composite
          ON bench_physical ({physical_column(HOT_SELECT)}, {physical_column(HOT_NUMBER)});
        """
    )


async def load_data(conn: asyncpg.Connection, n_rows: int, rng: random.Random) -> None:
    jsonb_records = []
    physical_records = []
    for _ in range(n_rows):
        row_id = uuid.uuid4()
        props = make_properties(rng)
        jsonb_records.append((row_id, props))
        physical_records.append([row_id] + properties_to_physical_values(props))

    physical_col_names = ["id"] + [physical_column(k) for k in ALL_KEYS]

    await conn.copy_records_to_table(
        "bench_jsonb_unindexed", records=jsonb_records, columns=["id", "properties"]
    )
    await conn.copy_records_to_table(
        "bench_jsonb_indexed", records=jsonb_records, columns=["id", "properties"]
    )
    await conn.copy_records_to_table(
        "bench_physical", records=physical_records, columns=physical_col_names
    )

    await conn.execute("ANALYZE bench_jsonb_unindexed;")
    await conn.execute("ANALYZE bench_jsonb_indexed;")
    await conn.execute("ANALYZE bench_physical;")


# --------------------------------------------------------------------------
# Query shapes
# --------------------------------------------------------------------------

def jsonb_order_query(table: str) -> str:
    return f"""
        SELECT id, properties
        FROM {table}
        WHERE properties->'{HOT_SELECT}'->>'select' = $1
        ORDER BY ((properties->'{HOT_NUMBER}'->>'number'))::double precision
        LIMIT 50 OFFSET $2
    """


def jsonb_count_query(table: str) -> str:
    return f"""
        SELECT COUNT(*)
        FROM {table}
        WHERE properties->'{HOT_SELECT}'->>'select' = $1
    """


def physical_order_query() -> str:
    return f"""
        SELECT *
        FROM bench_physical
        WHERE {physical_column(HOT_SELECT)} = $1
        ORDER BY {physical_column(HOT_NUMBER)}
        LIMIT 50 OFFSET $2
    """


def physical_count_query() -> str:
    return f"""
        SELECT COUNT(*)
        FROM bench_physical
        WHERE {physical_column(HOT_SELECT)} = $1
    """


async def time_prepared(
    conn: asyncpg.Connection, sql: str, arg_fn, iterations: int
) -> list[float]:
    """Prepare once, execute `iterations` times with varying params, return ms timings."""
    stmt = await conn.prepare(sql)
    timings = []
    for _ in range(iterations):
        args = arg_fn()
        start = time.perf_counter()
        await stmt.fetch(*args)
        elapsed_ms = (time.perf_counter() - start) * 1000
        timings.append(elapsed_ms)
    return timings


def p(values: list[float], pct: float) -> float:
    if not values:
        return float("nan")
    return statistics.quantiles(values, n=100, method="inclusive")[int(pct) - 1] if pct < 100 else max(values)


def summarize(values: list[float]) -> dict:
    return {
        "p50": statistics.median(values),
        "p95": p(values, 95),
        "min": min(values),
        "max": max(values),
        "n": len(values),
    }


async def benchmark_table(
    conn: asyncpg.Connection, label: str, order_sql: str, count_sql: str, rng: random.Random
) -> dict:
    def order_args_offset0():
        return [rng.choice(SELECT_OPTIONS[HOT_SELECT]), 0]

    def order_args_offset10k():
        return [rng.choice(SELECT_OPTIONS[HOT_SELECT]), 10_000]

    def count_args():
        return [rng.choice(SELECT_OPTIONS[HOT_SELECT])]

    results = {}
    results["order_offset0"] = summarize(
        await time_prepared(conn, order_sql, order_args_offset0, ITERATIONS_PER_SHAPE)
    )
    results["order_offset10000"] = summarize(
        await time_prepared(conn, order_sql, order_args_offset10k, ITERATIONS_PER_SHAPE)
    )
    results["count"] = summarize(
        await time_prepared(conn, count_sql, count_args, ITERATIONS_PER_SHAPE)
    )
    return results


async def explain_snippet(conn: asyncpg.Connection, sql: str, args: list) -> str:
    rows = await conn.fetch(f"EXPLAIN {sql}", *args)
    return "\n".join(r[0] for r in rows[:5])


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def _jsonb_binary_encoder(value) -> bytes:
    # jsonb binary wire format: 1-byte version prefix (1) + utf-8 JSON text.
    # asyncpg's copy_records_to_table requires a *binary* codec; the default
    # text-format set_type_codec() only covers the simple query/extended
    # protocol paths, not COPY.
    return b"\x01" + json.dumps(value).encode("utf-8")


def _jsonb_binary_decoder(data: bytes):
    return json.loads(data[1:].decode("utf-8"))


async def run(row_counts: list[int]) -> dict:
    conn = await asyncpg.connect(DSN)
    await conn.set_type_codec(
        "jsonb",
        encoder=_jsonb_binary_encoder,
        decoder=_jsonb_binary_decoder,
        schema="pg_catalog",
        format="binary",
    )

    all_results = {}
    try:
        for n_rows in row_counts:
            print(f"\n=== {n_rows} rows ===")
            rng = random.Random(RNG_SEED + n_rows)

            print("  building schema...")
            await setup_schema(conn)
            print(f"  loading {n_rows} rows into all 3 layouts...")
            t0 = time.perf_counter()
            await load_data(conn, n_rows, rng)
            print(f"  load took {time.perf_counter() - t0:.1f}s")

            row_result = {}
            for label, order_sql, count_sql in [
                ("jsonb_unindexed", jsonb_order_query("bench_jsonb_unindexed"),
                 jsonb_count_query("bench_jsonb_unindexed")),
                ("jsonb_indexed", jsonb_order_query("bench_jsonb_indexed"),
                 jsonb_count_query("bench_jsonb_indexed")),
                ("physical", physical_order_query(), physical_count_query()),
            ]:
                print(f"  timing {label}...")
                row_result[label] = await benchmark_table(conn, label, order_sql, count_sql, rng)

            # Capture one EXPLAIN per layout for the indexed order query, to
            # confirm the planner actually used the expression/physical index.
            plans = {}
            sample_args = [rng.choice(SELECT_OPTIONS[HOT_SELECT]), 0]
            plans["jsonb_unindexed"] = await explain_snippet(
                conn, jsonb_order_query("bench_jsonb_unindexed"), sample_args
            )
            plans["jsonb_indexed"] = await explain_snippet(
                conn, jsonb_order_query("bench_jsonb_indexed"), sample_args
            )
            plans["physical"] = await explain_snippet(conn, physical_order_query(), sample_args)

            all_results[n_rows] = {"timings": row_result, "plans": plans}
    finally:
        await conn.close()

    return all_results


def fmt_ms(v: float) -> str:
    return f"{v:.2f}"


def print_report(results: dict) -> str:
    lines = []
    lines.append("# Storage benchmark results\n")
    lines.append(
        "Milestone 0 of the Notion-databases plan. Compares JSONB (with and without "
        "B-tree expression indexes on hot properties) against a physical `f_<key>`-column "
        "table, for the product's view-load query shape:\n"
    )
    lines.append(
        "```sql\nWHERE <select-property> = ?  ORDER BY <number-property>  LIMIT 50 [OFFSET n]\n```\n"
    )
    lines.append(f"Hot properties: `{HOT_SELECT}` (select, equality filter), `{HOT_NUMBER}` (number, sort key).\n")
    lines.append(f"20 properties per row, {ITERATIONS_PER_SHAPE} timed iterations per (table, shape) with randomized filter values, prepared statement reused across iterations.\n")

    decision_gate_ms = 200.0
    verdict_rows = []

    for n_rows, data in results.items():
        lines.append(f"\n## {n_rows:,} rows\n")
        lines.append("| Layout | Shape | p50 (ms) | p95 (ms) | min (ms) | max (ms) | n |")
        lines.append("|---|---|---:|---:|---:|---:|---:|")
        for label, shapes in data["timings"].items():
            for shape_name, s in shapes.items():
                lines.append(
                    f"| {label} | {shape_name} | {fmt_ms(s['p50'])} | {fmt_ms(s['p95'])} "
                    f"| {fmt_ms(s['min'])} | {fmt_ms(s['max'])} | {s['n']} |"
                )
                if label == "jsonb_indexed" and shape_name in ("order_offset0", "order_offset10000"):
                    verdict_rows.append((n_rows, shape_name, s["p95"]))

        lines.append("\n### EXPLAIN (order query, sample args)\n")
        for label, plan in data["plans"].items():
            lines.append(f"**{label}**\n```\n{plan}\n```\n")

    # Decision gate: jsonb_indexed @ 50k rows, both offsets.
    lines.append("\n## Decision gate\n")
    lines.append(
        f"Gate: p95 for `WHERE <prop> = ? ORDER BY <other> LIMIT 50` must be **≤ {decision_gate_ms:.0f} ms "
        "at 50,000 rows with expression indexes present** (spec §4.3 escape-hatch threshold).\n"
    )

    fifty_k_indexed = [
        (shape, p95) for (rows, shape, p95) in verdict_rows if rows == 50000
    ]
    if fifty_k_indexed:
        worst_shape, worst_p95 = max(fifty_k_indexed, key=lambda x: x[1])
        go = worst_p95 <= decision_gate_ms
        lines.append(f"- Worst observed p95 at 50k rows (jsonb_indexed): **{fmt_ms(worst_p95)} ms** ({worst_shape})")
        lines.append(f"- Verdict: **{'GO' if go else 'NO-GO'}** — {'within' if go else 'EXCEEDS'} the {decision_gate_ms:.0f}ms threshold.")
        if not go:
            lines.append(
                "\n**STOP AND ESCALATE**: spec §4.3's escape hatch (promote to a physical "
                "`f_<key>` table) applies. The storage decision must be revisited before "
                "M2 builds UI on it.\n"
            )
    else:
        lines.append("- No 50k-row data collected — cannot render a verdict.")

    report = "\n".join(lines)
    return report


async def main() -> None:
    parser = argparse.ArgumentParser(description="Notion-databases storage layout benchmark")
    parser.add_argument("--rows", default="10000,50000", help="comma-separated row counts, e.g. 10000,50000")
    parser.add_argument(
        "--out",
        default=None,
        help="path to write the markdown results report (default: docs/research/storage-benchmark-results.md relative to repo root)",
    )
    args = parser.parse_args()
    row_counts = [int(x.strip()) for x in args.rows.split(",") if x.strip()]

    results = await run(row_counts)
    report = print_report(results)

    print("\n" + "=" * 70)
    print(report)

    out_path = args.out
    if out_path is None:
        import pathlib
        repo_root = pathlib.Path(__file__).resolve().parents[2]
        out_path = repo_root / "docs" / "research" / "storage-benchmark-results.md"
    with open(out_path, "w") as f:
        f.write(report + "\n")
    print(f"\nWrote results to {out_path}")


if __name__ == "__main__":
    asyncio.run(main())
