"""The portable intermediate representation (IR) of a note.

One definition of "a note" shared by every destination (mirror, backup
archive). It names neither the editor's prop names nor any destination's
payload shapes (docs/notion-sync/DESIGN.md §4, ADR-07).
"""
from .ir import IR_VERSION, Block, Inline, Obj, Ref, Text  # noqa: F401
from .losses import Loss  # noqa: F401
