"""Icon validation: Notion validates emoji strictly (T9)."""
import re
import unicodedata


_EMOJI_RE = re.compile(r"[\U0001F000-\U0001FAFF←-⯿☀-➿©®‼⁉"
                       r"™ℹ〰〽㊗㊙\U0001F1E6-\U0001F1FF]")


def looks_like_emoji(s: str) -> bool:
    """Notion validates icons strictly (T9: "abc" -> 400). Accept only short
    strings that are made of emoji, joiners and variation selectors."""
    if not s or len(s) > 16:
        return False
    core = [c for c in s if c not in "‍️" and not unicodedata.category(c).startswith("Mn")
            and not (0x1F3FB <= ord(c) <= 0x1F3FF)]
    return bool(core) and all(_EMOJI_RE.match(c) for c in core)
