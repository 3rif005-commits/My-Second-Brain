"""Skill loader — a skill is a flat `.md` file or a folder with a `SKILL.md`.

A skill = metadata + a body of instructions + optional reference files.

The folder form exists for progressive disclosure. A prompt that carries every
skill's full text pays for all of them on every turn; the metadata alone is
about a hundred tokens, and that is what belongs in the system prompt. The body
is read when a skill is actually chosen, and `reference()` files only when the
work reaches them.

    skills/study-guide/
      SKILL.md                     ← frontmatter + the procedure
      references/notion-dialect.md ← loaded only when needed

Frontmatter beyond name/description is optional and describes where a skill may
run and what it produces, so a surface can offer the right ones and the harness
knows where to put the output.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    body: str
    tools: list[str] | None       # None = allow all permitted by tier
    priority: int                 # tiebreak; higher wins
    source_path: Path
    #: where the skill may be offered ("workspace", "chat", "editor", …).
    #: Empty means anywhere — the old flat skills keep working unchanged.
    surfaces: tuple[str, ...] = ()
    #: what it consumes ("sources", "selection", "note", "database")
    inputs: str | None = None
    #: what it produces, which is what tells a surface where to put the result
    #: ("draft_note", "insert_at_cursor", "rows_proposal", "chat")
    output: str | None = None
    #: "fast" | "standard" | "deep" — mapped to models in settings, not here
    model_tier: str | None = None
    #: may the classifier pick this without being asked? Default False: the
    #: Notion rule, and the reason the workspace stopped generating unasked.
    auto: bool = False
    #: show an estimate and wait for a click before running
    confirm: bool = False
    #: folder skills only — the directory holding SKILL.md and references/
    folder: Path | None = None

    def reference(self, relative: str) -> str:
        """Read one reference file, on demand.

        Deliberately not loaded at startup: a reference is usually the long
        part (a style guide, a worked example), and the whole point of the
        folder form is that it costs nothing until the work needs it.
        """
        if self.folder is None:
            raise FileNotFoundError(
                f"skill '{self.name}' is a single file and has no references")
        path = (self.folder / relative).resolve()
        if not str(path).startswith(str(self.folder.resolve())):
            raise ValueError(f"reference escapes the skill folder: {relative}")
        return path.read_text(encoding="utf-8")

    def references(self) -> list[str]:
        """Reference files this skill ships, as paths relative to the folder."""
        if self.folder is None:
            return []
        ref_dir = self.folder / "references"
        if not ref_dir.is_dir():
            return []
        return sorted(f"references/{p.name}" for p in ref_dir.iterdir()
                      if p.is_file())


_FRONTMATTER_RE = re.compile(
    r"^---\s*\n(?P<yaml>.*?)\n---\s*\n(?P<body>.*)$",
    re.DOTALL,
)


def parse_frontmatter(raw: str, source_path: Path,
                      folder: Path | None = None) -> Skill:
    match = _FRONTMATTER_RE.match(raw)
    if not match:
        raise ValueError(f"{source_path}: missing frontmatter delimiters")
    meta = yaml.safe_load(match.group("yaml")) or {}
    body = match.group("body").strip()
    if not meta.get("name"):
        raise ValueError(f"{source_path}: 'name' is required in frontmatter")
    if not meta.get("description"):
        raise ValueError(f"{source_path}: 'description' is required")

    surfaces = meta.get("surfaces") or ()
    if isinstance(surfaces, str):
        surfaces = [s.strip() for s in surfaces.split(",") if s.strip()]

    return Skill(
        name=meta["name"],
        description=meta["description"],
        body=body,
        tools=meta.get("tools"),
        priority=int(meta.get("priority", 0)),
        source_path=source_path,
        surfaces=tuple(surfaces),
        inputs=meta.get("inputs"),
        output=meta.get("output"),
        model_tier=meta.get("model_tier"),
        auto=bool(meta.get("auto", False)),
        confirm=bool(meta.get("confirm", False)),
        folder=folder,
    )


class SkillRegistry:
    def __init__(self, skills: dict[str, Skill]):
        self._skills = skills

    @classmethod
    def load(cls, dirs: list[Path]) -> "SkillRegistry":
        """Load skills from each dir in order. Later dirs override earlier
        (so user dir wins over bundled).

        Both shapes are read: `<dir>/<name>.md` and `<dir>/<name>/SKILL.md`. A
        malformed skill is skipped with a warning rather than taking the whole
        registry down — one bad user file must not disable the assistant.
        """
        skills: dict[str, Skill] = {}
        for d in dirs:
            if not d.exists():
                continue
            for path in sorted(d.glob("*.md")):
                skill = cls._read(path)
                if skill:
                    skills[skill.name] = skill
            for sub in sorted(p for p in d.iterdir() if p.is_dir()):
                manifest = sub / "SKILL.md"
                if manifest.is_file():
                    skill = cls._read(manifest, folder=sub)
                    if skill:
                        skills[skill.name] = skill
        return cls(skills)

    @staticmethod
    def _read(path: Path, folder: Path | None = None) -> "Skill | None":
        try:
            return parse_frontmatter(path.read_text(encoding="utf-8"), path, folder)
        except Exception as e:                      # noqa: BLE001
            logger.warning("skipping skill %s: %s", path, e)
            return None

    def index(self) -> str:
        """The metadata-only listing that belongs in a system prompt.

        Roughly a hundred tokens per skill instead of the whole body, which is
        what lets the catalogue grow without the base prompt growing with it.
        """
        return "\n".join(f"- {s.name}: {s.description}"
                          for s in sorted(self._skills.values(), key=lambda s: s.name))

    def for_surface(self, surface: str) -> list["Skill"]:
        """Skills a given surface may offer. No `surfaces` means anywhere."""
        return [s for s in self.all() if not s.surfaces or surface in s.surfaces]

    def names(self) -> list[str]:
        return list(self._skills.keys())

    def get(self, name: str) -> "Skill | None":
        return self._skills.get(name)

    def all(self) -> list[Skill]:
        return list(self._skills.values())


_WORD_RE = re.compile(r"[a-zA-Z0-9]+")


def _tokenize(s: str) -> set[str]:
    return {w.lower() for w in _WORD_RE.findall(s)}


def classify_skills(
    query: str,
    skills: list[Skill],
    limit: int = 3,
    require_auto: bool = False,
) -> list[Skill]:
    """Pick top-N skills whose description shares keywords with the query.

    Phase 1: simple keyword overlap. Future: small-LLM classifier.
    Skills with zero overlap are excluded entirely.

    `require_auto` restricts the pick to skills that opted in with `auto: true`
    — the rule Notion settles on, and the one that keeps a surface from running
    expensive work nobody asked for.
    """
    query_tokens = _tokenize(query)
    scored: list[tuple[int, int, Skill]] = []
    for skill in skills:
        if require_auto and not skill.auto:
            continue
        desc_tokens = _tokenize(skill.description)
        overlap = len(query_tokens & desc_tokens)
        if overlap == 0:
            continue
        scored.append((overlap, skill.priority, skill))
    # Sort: higher overlap first, then higher priority
    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [s for (_, _, s) in scored[:limit]]
