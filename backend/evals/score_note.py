"""The deterministic note scorer now lives in the app
(services/workspace/note_score.py): the result card's quality check uses it
after every study guide (E9). Evals import it from here, unchanged."""
from services.workspace.note_score import (  # noqa: F401
    ANCHOR_RE, CALLOUT_TYPES, NoteScore, score_note,
)
