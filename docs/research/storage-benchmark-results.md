# Storage benchmark results

Milestone 0 of the Notion-databases plan. Compares JSONB (with and without B-tree expression indexes on hot properties) against a physical `f_<key>`-column table, for the product's view-load query shape:

```sql
WHERE <select-property> = ?  ORDER BY <number-property>  LIMIT 50 [OFFSET n]
```

Hot properties: `selStat1` (select, equality filter), `numPri04` (number, sort key).

20 properties per row, 40 timed iterations per (table, shape) with randomized filter values, prepared statement reused across iterations.


## 10,000 rows

| Layout | Shape | p50 (ms) | p95 (ms) | min (ms) | max (ms) | n |
|---|---|---:|---:|---:|---:|---:|
| jsonb_unindexed | order_offset0 | 70.12 | 89.54 | 60.92 | 101.80 | 40 |
| jsonb_unindexed | order_offset10000 | 81.86 | 100.99 | 66.57 | 111.03 | 40 |
| jsonb_unindexed | count | 58.76 | 74.63 | 44.55 | 76.33 | 40 |
| jsonb_indexed | order_offset0 | 4.59 | 7.12 | 3.39 | 9.09 | 40 |
| jsonb_indexed | order_offset10000 | 18.78 | 87.68 | 13.28 | 105.70 | 40 |
| jsonb_indexed | count | 56.34 | 73.88 | 44.75 | 77.03 | 40 |
| physical | order_offset0 | 1.13 | 2.09 | 0.96 | 3.41 | 40 |
| physical | order_offset10000 | 2.97 | 3.93 | 1.99 | 4.05 | 40 |
| physical | count | 0.62 | 0.82 | 0.52 | 0.93 | 40 |

### EXPLAIN (order query, sample args)

**jsonb_unindexed**
```
Limit  (cost=2416.91..2417.04 rows=50 width=1618)
  ->  Sort  (cost=2416.91..2417.04 rows=50 width=1618)
        Sort Key: ((((properties -> 'numPri04'::text) ->> 'number'::text))::double precision)
        ->  Seq Scan on bench_jsonb_unindexed  (cost=0.00..2415.50 rows=50 width=1618)
              Filter: (((properties -> 'selStat1'::text) ->> 'select'::text) = 'blocked'::text)
```

**jsonb_indexed**
```
Limit  (cost=0.29..128.58 rows=50 width=1618)
  ->  Index Scan using bench_jsonb_indexed_composite on bench_jsonb_indexed  (cost=0.29..6214.87 rows=2422 width=1618)
        Index Cond: (((properties -> 'selStat1'::text) ->> 'select'::text) = 'blocked'::text)
```

**physical**
```
Limit  (cost=0.29..89.19 rows=50 width=801)
  ->  Index Scan using bench_physical_composite on bench_physical  (cost=0.29..4306.67 rows=2422 width=801)
        Index Cond: (f_selstat1 = 'blocked'::text)
```


## 50,000 rows

| Layout | Shape | p50 (ms) | p95 (ms) | min (ms) | max (ms) | n |
|---|---|---:|---:|---:|---:|---:|
| jsonb_unindexed | order_offset0 | 401.01 | 459.90 | 362.97 | 486.06 | 40 |
| jsonb_unindexed | order_offset10000 | 437.47 | 499.43 | 399.39 | 504.59 | 40 |
| jsonb_unindexed | count | 295.46 | 331.01 | 269.31 | 336.78 | 40 |
| jsonb_indexed | order_offset0 | 4.04 | 5.34 | 3.44 | 12.02 | 40 |
| jsonb_indexed | order_offset10000 | 75.40 | 303.51 | 61.20 | 321.90 | 40 |
| jsonb_indexed | count | 281.47 | 312.47 | 247.55 | 329.29 | 40 |
| physical | order_offset0 | 1.21 | 1.99 | 0.98 | 2.92 | 40 |
| physical | order_offset10000 | 10.80 | 63.98 | 8.84 | 82.95 | 40 |
| physical | count | 1.93 | 3.40 | 1.67 | 4.04 | 40 |

### EXPLAIN (order query, sample args)

**jsonb_unindexed**
```
Limit  (cost=12021.80..12021.93 rows=50 width=1614)
  ->  Sort  (cost=12021.80..12022.43 rows=250 width=1614)
        Sort Key: ((((properties -> 'numPri04'::text) ->> 'number'::text))::double precision)
        ->  Seq Scan on bench_jsonb_unindexed  (cost=0.00..12013.50 rows=250 width=1614)
              Filter: (((properties -> 'selStat1'::text) ->> 'select'::text) = 'in_progress'::text)
```

**jsonb_indexed**
```
Limit  (cost=0.41..126.63 rows=50 width=1616)
  ->  Index Scan using bench_jsonb_indexed_composite on bench_jsonb_indexed  (cost=0.41..31963.60 rows=12662 width=1616)
        Index Cond: (((properties -> 'selStat1'::text) ->> 'select'::text) = 'in_progress'::text)
```

**physical**
```
Limit  (cost=0.41..86.09 rows=50 width=801)
  ->  Index Scan using bench_physical_composite on bench_physical  (cost=0.41..21575.66 rows=12592 width=801)
        Index Cond: (f_selstat1 = 'in_progress'::text)
```


## Decision gate

Gate: p95 for `WHERE <prop> = ? ORDER BY <other> LIMIT 50` must be **≤ 200 ms at 50,000 rows with expression indexes present** (spec §4.3 escape-hatch threshold).

- Worst observed p95 at 50k rows (jsonb_indexed): **303.51 ms** (order_offset10000)
- Verdict: **NO-GO** — EXCEEDS the 200ms threshold.

**STOP AND ESCALATE**: spec §4.3's escape hatch (promote to a physical `f_<key>` table) applies. The storage decision must be revisited before M2 builds UI on it.

## Analysis

**Without expression indexes, JSONB is unusable even at 10k rows.** `jsonb_unindexed`'s
`ORDER BY` shape is already p95 ≈ 90–101ms at 10k rows (full seq scan + sort) and blows
past 400–500ms at 50k. This confirms spec §4's mitigation is load-bearing, not optional:
expression indexes on hot properties are mandatory, not a nice-to-have.

**With expression indexes and `OFFSET 0`, JSONB is fast — genuinely competitive.**
`jsonb_indexed`'s `order_offset0` p95 is 5.34ms at 50k rows, ~85x faster than the
unindexed case and within ~4x of the physical table's 1.99ms. The composite expression
index (`(properties->'selStat1'->>'select', (properties->'numPri04'->>'number')::double
precision)`) lets Postgres use an `Index Scan` directly, matching the physical table's
plan shape. **This is the common case for a real view load** (first page, no pagination
offset) and it comfortably clears the 200ms gate.

**`OFFSET 10000` is where it breaks, and the cause is heap-fetch cost, not the index.**
Both layouts use the same index scan plan at both offsets — Postgres has to walk and
discard the first *offset* matching index entries before returning the next 50, so cost
scales with the offset value for both layouts (an inherent `OFFSET` pagination cost, not
specific to JSONB). What differs is the cost of visiting each of those ~10,050 rows'
heap tuples: JSONB heap tuples carry the full 20-property payload (`width=1616` in the
`EXPLAIN` output above) vs. the physical table's typed columns (`width=801`) — roughly
2x the row width — and the resulting **jsonb_indexed heap table is 124MB vs. physical's
48MB for the same 50,000 rows** (measured via `pg_total_relation_size`). That heap-size
and per-tuple-cost gap is enough to push `jsonb_indexed`'s offset-10000 p95 to 303.51ms
(vs. physical's 63.98ms) — over the gate even though the *index* itself is doing its job.

**A second, related finding outside the letter of the gate: filtered `COUNT(*)` is also
slow on JSONB, even indexed.** `jsonb_indexed`'s filtered count p95 is 312.47ms at 50k
rows — barely better than the *unindexed* count (331.01ms) and 90x slower than physical's
3.40ms. `EXPLAIN` shows why: for `bench_jsonb_indexed`, Postgres chooses a **Seq Scan**
over the available expression index, while for `bench_physical` it chooses an **Index
Only Scan** that never touches the heap. With matching rows for one `select` value
scattered essentially randomly across the whole table, an index-driven MVCC visibility
check needs one heap-page visit per matching row; on the physical table's compact 48MB
heap that is cheap, but on the JSONB table's 124MB heap of wide tuples, the planner
correctly decides a single sequential pass over ~15,872 pages beats ~12,600 scattered
random heap fetches. The brief's decision gate is scoped only to the `ORDER BY` shape, so
this does not change the verdict above, but it is a second, independent data point that
the JSONB layout's viability at 50k rows is more marginal than the single `ORDER BY`
number suggests — a "row count" affordance in the UI (e.g. a view's footer count) would
also need attention if the storage decision is revisited.

**Takeaway for the escalation:** the JSONB design survives the *first-page* view load at
50k rows, but two of its four "at 50k with expression indexes" numbers (offset-10000
`ORDER BY`, and filtered `COUNT(*)`) exceed 200ms p95 by roughly 1.5x–1.6x. Since this
benchmark's tables are structurally identical to `db_row_props` (§3.2) — scalars only, no
long text — this is not an artifact of unrealistic row content; it is the JSONB
heap-tuple-width and index-vs-seqscan tradeoff at this row count. Candidate mitigations to
evaluate before revisiting the storage decision, in rough order of effort: (a) switch
paginated view scrolling from `OFFSET` to keyset/cursor pagination (eliminates the
offset-10000 cost entirely, for both layouts — likely the highest-leverage, lowest-risk
fix); (b) add `INCLUDE` columns or a narrower covering index so filtered counts can go
index-only; (c) fall back to spec §4.3's per-data-source physical-table escape hatch for
data sources that exceed some row threshold.

