"""The IR: exactly DESIGN §4, `ir_version = 1`.

Plain dataclasses with a stable `to_dict`. Nothing here names a source-editor prop
or a destination shape.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Union

from .losses import Loss

IR_VERSION = 1

BLOCK_TYPES = (
    "paragraph", "heading", "list_item", "todo", "toggle", "quote", "code",
    "equation", "divider", "table", "media", "callout", "columns", "column",
    "embed", "bookmark", "db_embed", "anchor", "action", "opaque",
)
MARKS = ("bold", "italic", "underline", "strike", "code")


@dataclass(frozen=True)
class Ref:
    kind: str
    id: str
    sub: str = ""

    def to_dict(self) -> dict:
        d = {"kind": self.kind, "id": self.id}
        if self.sub:
            d["sub"] = self.sub
        return d


@dataclass
class Text:
    """A run of text. `marks` holds only the marks that are on (stable hash):
    bold/italic/underline/strike/code -> True, color/bg -> a palette name."""
    text: str
    marks: dict[str, Any] = field(default_factory=dict)
    link: str | None = None
    type: str = "text"

    def to_dict(self) -> dict:
        d: dict = {"type": "text", "text": self.text}
        if self.marks:
            d["marks"] = dict(self.marks)
        if self.link:
            d["link"] = self.link
        return d


@dataclass
class Mention:
    target: Ref
    label: str
    type: str = "mention"

    def to_dict(self) -> dict:
        return {"type": "mention", "target": self.target.to_dict(), "label": self.label}


@dataclass
class Equation:
    latex: str
    type: str = "equation"

    def to_dict(self) -> dict:
        return {"type": "equation", "latex": self.latex}


Inline = Union[Text, Mention, Equation]


@dataclass
class Block:
    type: str
    attrs: dict[str, Any] = field(default_factory=dict)
    inline: list[Inline] = field(default_factory=list)
    children: list["Block"] = field(default_factory=list)
    src_id: str = ""
    losses: list[Loss] = field(default_factory=list)

    def to_dict(self) -> dict:
        d: dict = {"type": self.type}
        if self.attrs:
            d["attrs"] = self.attrs
        if self.inline:
            d["inline"] = [i.to_dict() for i in self.inline]
        if self.children:
            d["children"] = [c.to_dict() for c in self.children]
        if self.src_id:
            d["src_id"] = self.src_id
        if self.losses:
            d["losses"] = [loss.to_dict() for loss in self.losses]
        return d


@dataclass
class Obj:
    kind: str                      # page | database | data_source | view | file | collection
    ref: Ref
    parent: Ref | None = None
    order: float = 0.0
    title: list[Inline] = field(default_factory=list)
    icon: str | None = None
    props: dict[str, Any] = field(default_factory=dict)
    body: list[Block] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)
    losses: list[Loss] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "ir_version": IR_VERSION,
            "kind": self.kind,
            "ref": self.ref.to_dict(),
            "parent": self.parent.to_dict() if self.parent else None,
            "order": self.order,
            "title": [i.to_dict() for i in self.title],
            "icon": self.icon,
            "props": self.props,
            "body": [b.to_dict() for b in self.body],
            "meta": self.meta,
            "losses": [loss.to_dict() for loss in self.losses],
        }


def plain_text(inline: list[Inline]) -> str:
    out = []
    for i in inline:
        out.append(i.text if isinstance(i, Text) else
                   i.label if isinstance(i, Mention) else i.latex)
    return "".join(out)


def walk(blocks: list[Block]):
    for b in blocks:
        yield b
        yield from walk(b.children)
