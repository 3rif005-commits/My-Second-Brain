"""The portable intermediate representation (IR) of a note.

Shared by the Notion mirror and, later, the local backup archive, so both
share one definition of "a note". Knows neither BlockNote prop names nor
Notion payload shapes (docs/notion-sync/DESIGN.md §4, ADR-07).
"""
from .ir import IR_VERSION, Block, Inline, Obj, Ref, Text  # noqa: F401
from .losses import Loss  # noqa: F401
