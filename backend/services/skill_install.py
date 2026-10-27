"""Installing a skill from outside the app — with OpenClaw's lesson applied.

OpenClaw's skill marketplace (ClawHub) had hundreds of malicious skills in
2026 (Koi Security's "ClawHavoc", Unit 42). What made that possible: skills
that ran code, installs nobody read, and updates that arrived by themselves.
So here:

  * text only — a skill is SKILL.md plus reference .md/.txt files; anything
    else in the folder (scripts, binaries) is listed as skipped and never
    stored, let alone run;
  * read before install — `preview` fetches and shows everything; nothing is
    saved. `install` fetches again and refuses unless the content is exactly
    what the preview showed (a SHA-256 over every file);
  * pinned — a GitHub folder is resolved to one commit SHA; a plain link is
    pinned by its content hash. Nothing updates by itself: `check_update`
    shows a diff and `update` applies only that diff, by the same hash rule;
  * fetched through the SSRF guard (services/egress.py), size-capped;
  * no shadowing — an installed skill cannot take a built-in's name or one of
    the user's own;
  * origin "installed" — untrusted text from then on (services/agent/
    skills.py): never picked unasked, and a turn that uses it asks first.

Sources: a GitHub folder (https://github.com/<owner>/<repo>/tree/<ref>/<path>)
or a direct https link to a SKILL.md file.
"""
from __future__ import annotations

import difflib
import hashlib
import json
import re
from dataclasses import dataclass
from urllib.parse import quote, urlsplit

from services import egress, skill_store
from services.skill_store import FILE, NAME, SkillRejected
from services.text_hygiene import instruction_like, strip_invisible

MAX_FILES = 20
_GITHUB_TREE = re.compile(
    r"^https://github\.com/(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+)"
    r"/tree/(?P<ref>[^/]+)(?:/(?P<path>.+?))?/?$")
_GH_HEADERS = {"Accept": "application/vnd.github+json"}
_SHA = re.compile(r"^[0-9a-f]{40}$")


@dataclass(frozen=True)
class Source:
    url: str
    kind: str                      # "github" | "url"
    owner: str = ""
    repo: str = ""
    ref: str = ""
    path: str = ""


def parse_source(url: str) -> Source:
    url = (url or "").strip()
    m = _GITHUB_TREE.match(url)
    if m:
        return Source(url, "github", m["owner"], m["repo"], m["ref"], (m["path"] or "").strip("/"))
    parts = urlsplit(url)
    if parts.scheme == "https" and parts.path.endswith("SKILL.md"):
        return Source(url, "url")
    raise SkillRejected("Paste a GitHub folder link (https://github.com/owner/repo/tree/main/"
                        "path) or an https link to a SKILL.md file.")


def _get_json(url: str):
    try:
        return json.loads(egress.fetch(url, max_bytes=2_000_000, headers=_GH_HEADERS).text)
    except ValueError as e:
        raise SkillRejected(f"GitHub did not answer: {e}") from None


def _text(url: str) -> str:
    return egress.fetch(url, max_bytes=skill_store.FILE_MAX * 4).text


def _github_files(src: Source, sha: str) -> tuple[dict[str, str], list[str]]:
    base = f"https://api.github.com/repos/{src.owner}/{src.repo}/contents"
    folder = quote(src.path)

    def listing(sub: str) -> list[dict]:
        url = f"{base}/{folder}{'/' + quote(sub) if sub else ''}?ref={sha}"
        data = _get_json(url)
        if not isinstance(data, list):
            raise SkillRejected("That link is not a folder.")
        return data

    files: dict[str, str] = {}
    skipped: list[str] = []
    raw = f"https://raw.githubusercontent.com/{src.owner}/{src.repo}/{sha}/{folder}"
    for entry in listing(""):
        name, kind = str(entry.get("name") or ""), entry.get("type")
        if kind == "file" and name == "SKILL.md":
            files["SKILL.md"] = _text(f"{raw}/SKILL.md")
        elif kind == "dir" and name in ("reference", "references"):
            for sub in listing(name):
                rel = f"{name}/{sub.get('name')}"
                if sub.get("type") == "file" and FILE.match(rel):
                    files[rel] = _text(f"{raw}/{quote(rel)}")
                else:
                    skipped.append(rel)
        else:
            skipped.append(name + ("/" if kind == "dir" else ""))
        if len(files) > MAX_FILES:
            raise SkillRejected(f"A skill may hold at most {MAX_FILES} files.")
    return files, sorted(skipped)


def resolve(src: Source) -> tuple[str, dict[str, str], list[str]]:
    """(pin, files, skipped) for a source as it is right now."""
    if src.kind == "github":
        commit = _get_json(f"https://api.github.com/repos/{src.owner}/{src.repo}/commits/{quote(src.ref)}")
        sha = str((commit or {}).get("sha") or "") if isinstance(commit, dict) else ""
        if not _SHA.match(sha):
            raise SkillRejected(f"Could not find '{src.ref}' in {src.owner}/{src.repo}.")
        files, skipped = _github_files(src, sha)
        pin = sha
    else:
        files, skipped = {"SKILL.md": _text(src.url)}, []
        pin = ""
    if "SKILL.md" not in files:
        raise SkillRejected("No SKILL.md there: that is not a skill folder.")
    # Hidden characters never reach storage; the hash is over what is stored.
    files = {rel: strip_invisible(text) for rel, text in files.items()}
    for rel, text in files.items():
        if len(text) > skill_store.FILE_MAX:
            raise SkillRejected(f"'{rel}' is longer than {skill_store.FILE_MAX:,} characters.")
    return pin or "sha256:" + content_hash(files), files, skipped


def content_hash(files: dict[str, str]) -> str:
    return hashlib.sha256(json.dumps(files, sort_keys=True, ensure_ascii=False)
                          .encode()).hexdigest()


def _meta(files: dict[str, str]) -> dict:
    meta = skill_store._frontmatter(files.get("SKILL.md", ""))
    name = str(meta.get("name") or "").strip()
    if not NAME.match(name):
        raise SkillRejected("The skill's SKILL.md needs a name in lowercase-kebab-case.")
    if not str(meta.get("description") or "").strip():
        raise SkillRejected("The skill's SKILL.md needs a description.")
    return meta


def _summary(source: Source, pin: str, files: dict[str, str], skipped: list[str]) -> dict:
    meta = _meta(files)
    flags = sorted({f for text in files.values() for f in instruction_like(text)})
    from services.skill_drafts import FLAG_TEXT
    body = files["SKILL.md"].split("\n---\n", 1)[-1].strip()
    return {
        "name": meta["name"], "description": str(meta["description"]).strip(),
        "body": body, "files": sorted(files), "skipped": skipped,
        "warnings": [FLAG_TEXT.get(f, f) for f in flags],
        "source": source.url, "pin": pin, "content_hash": content_hash(files),
    }


def preview(url: str, taken: set[str]) -> dict:
    """Everything the user should read before installing. Saves nothing."""
    src = parse_source(url)
    pin, files, skipped = resolve(src)
    out = _summary(src, pin, files, skipped)
    if out["name"] in taken:
        raise SkillRejected(f"You already have a skill named '{out['name']}'. An installed "
                            "skill cannot replace a built-in or one of yours.")
    return out


def install(user_id: str, url: str, expected_hash: str, taken: set[str]) -> dict:
    """Install exactly what the preview showed, or nothing."""
    src = parse_source(url)
    pin, files, skipped = resolve(src)
    out = _summary(src, pin, files, skipped)
    if out["content_hash"] != expected_hash:
        raise SkillRejected("The skill changed since you previewed it. Preview it again.")
    if out["name"] in taken:
        raise SkillRejected(f"You already have a skill named '{out['name']}'.")
    skill_store.put_files(user_id, out["name"], files, origin="installed", replace=True,
                          source=src.url, pin=pin)
    return out


def _diff(old: dict[str, str], new: dict[str, str]) -> str:
    lines: list[str] = []
    for rel in sorted(set(old) | set(new)):
        a, b = old.get(rel, ""), new.get(rel, "")
        if a != b:
            lines += difflib.unified_diff(a.splitlines(), b.splitlines(),
                                          f"before/{rel}", f"after/{rel}", lineterm="")
    return "\n".join(lines)


def _installed(user_id: str, name: str) -> dict:
    row = skill_store.get_row(user_id, name)
    if not row or row.get("origin") != "installed" or not row.get("source"):
        raise SkillRejected(f"'{name}' is not an installed skill.")
    return row


def check_update(user_id: str, name: str) -> dict:
    """The update as a diff, or up_to_date. Applies nothing."""
    row = _installed(user_id, name)
    src = parse_source(row["source"])
    pin, files, skipped = resolve(src)
    current = dict(row.get("files") or {})
    if content_hash(files) == content_hash(current):
        return {"up_to_date": True, "pin": row.get("pin")}
    out = _summary(src, pin, files, skipped)
    if out["name"] != name:
        raise SkillRejected(f"The source now names the skill '{out['name']}', not '{name}'. "
                            "Install it as a new skill instead.")
    return {**out, "up_to_date": False, "diff": _diff(current, files),
            "current_pin": row.get("pin")}


def update(user_id: str, name: str, expected_hash: str) -> dict:
    """Apply exactly the update the user reviewed, or nothing."""
    row = _installed(user_id, name)
    src = parse_source(row["source"])
    pin, files, skipped = resolve(src)
    out = _summary(src, pin, files, skipped)
    if out["content_hash"] != expected_hash:
        raise SkillRejected("The source changed again since you checked. Check again.")
    if out["name"] != name:
        raise SkillRejected("The source renamed the skill; install it as a new one.")
    skill_store.put_files(user_id, name, files, origin="installed", replace=True,
                          source=src.url, pin=pin)
    return out
