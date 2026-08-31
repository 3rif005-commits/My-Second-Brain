# Raw capture — `Edit property` (M2 completion)

Captured 2026-08-31 from the live fixture database, dark mode (the `Ctrl+Shift+L`
light-mode toggle did not take on this run; structure is unaffected, colours were
already measured in Phase 0).

Method: real `computer` clicks + `javascript_exec` reads of `innerText` and
per-row rects. Rows below are transcribed from those reads, not from a screenshot
alone.

---

## 1. The row is conditional on the property type

`Text` column header menu, top to bottom:

```
[Aa] [Text            ] (i)
Change type          >
AI Autofill  [Now with agents] >
------------------------------
Filter
Sort                 >
Group
Calculate            >
Freeze
Hide
Unwrap content
------------------------------
Insert left
Insert right
Duplicate property   (disabled)
Delete property
```

**There is no `Edit property` row.** The menu opens straight onto `Change type`.

`Number` and `Select` menus are identical except that `Edit property >` is inserted
as the **first** row, above `Change type`.

=> The rule: `Edit property` appears only for types that have per-type config.
Never render it as an empty panel.

## 2. `Edit property` for `Number`

Flyout, anchored to the row, flipped left (no room right):

```
Number format        Number   >
Decimal places       Default  >

Show as
[  42   ] [  ▬▬▬  ] [   ◜   ]
[Number ] [  Bar  ] [ Ring  ]

Changes apply to all views showing this property.
```

- `Show as` is a 3-card row, not a list. The selected card carries a blue border.
- The footer disclaimer is literal text, muted, centred-left, below a gap (no divider rule).

### 2a. `Number format` sub-flyout

Has its own search field, placeholder `Filter formats…`, autofocused.
45 rows, in this exact order:

```
Number
Number with separators
Percent
US Dollar (USD)
Australian dollar (AUD)
Canadian dollar (CAD)
Singapore dollar (SGD)
Euro (EUR)
Pound (GBP)
Yen (JPY)
Ruble (RUB)
Rupee (INR)
Won (KRW)
Yuan (CNY)
Real (BRL)
Lira (TRY)
Rupiah (IDR)
Franc (CHF)
Hong Kong dollar (HKD)
New Zealand dollar (NZD)
Swedish krona (SEK)
Norwegian krone (NOK)
Mexican peso (MXN)
Rand (ZAR)
New Taiwan dollar (TWD)
Danish krone (DKK)
Złoty (PLN)
Baht (THB)
Forint (HUF)
Koruna (CZK)
Shekel (ILS)
Chilean peso (CLP)
Philippine peso (PHP)
Dirham (AED)
Colombian peso (COP)
Riyal (SAR)
Ringgit (MYR)
Leu (RON)
Argentine peso (ARS)
Uruguayan peso (UYU)
Peruvian sol (PEN)
Vietnamese dong (VND)
Pakistani rupee (PKR)
Nigerian naira (NGN)
Bitcoin (BTC)
```

Our backend's `NumberFormat` enum has 39 of these. The 6 we do not carry are noted
in the spec; we render the intersection, ordered as above.

### 2b. `Decimal places` sub-flyout

No search. Anchored directly under the row (a select-style overlay, not a side flyout):

```
Default   ✓
0
1
2
3
4
5
```

## 3. `Edit property` for `Select`

```
[↑↓] Sort            Manual   >

Options                       +
[⠿] (Alpha)                   >

[✨] Generate with AI
```

- `Options` is a **section header with a trailing `+` button**, not a row.
- Each option row: drag handle `⠿` (hover-revealed), the option rendered as its own
  coloured pill (not plain text), and a trailing `>` opening the option editor.
- `Generate with AI` is a normal row in its own section at the bottom.
- No `Changes apply to all views…` footer on this one.

### 3a. `Sort` sub-overlay (of the options list)

Anchored under the row, select-style:

```
Manual                 ✓
Alphabetical
Reverse alphabetical
```

This sorts the **option list**, not the rows. Distinct from the header menu's own
`Sort` row.

### 3b. Option editor sub-panel (the `>` on an option row)

```
[ Alpha                    ] (i)
[🗑] Delete

Colors
[▪] Default
[▪] Gray
[▪] Brown
[▪] Orange
[▪] Yellow
[▪] Green
[▪] Blue
[▪] Purple            ✓
[▪] Pink
[▪] Red
```

- The name input is autofocused with its text **selected**.
- Exactly 10 colours, in that order. Each row has a filled swatch as its icon.
- The current colour carries a trailing `✓`.
- `Colors` is a section header.
- Row height measured at 28px; the name input at 20px inside a 36px header cell.

---

## What this changes in the implementation

1. `Edit property` is added to `buildColumnHeaderMenu` **only** for types with config.
2. `NumberCell` must format, or `Number format` is a dead control — done in the same
   milestone, not deferred.
3. The select/multi-select option editor is three levels deep
   (header menu -> options -> one option), which the `MenuList` push/pop stack and the
   popover flyout host already both support (verified live in M1/M2).
