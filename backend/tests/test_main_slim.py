"""main_slim must keep importing as the app grows: it is the deploy fallback
for hosts too small for the full build (see main_slim.py and render.yaml)."""
import main_slim


def test_slim_app_mounts_health_notes_and_databases():
    paths = {getattr(r, "path", "") for r in main_slim.app.routes}
    assert "/health" in paths
    assert any(p.startswith("/notes") for p in paths)
    assert any(p.startswith("/db") for p in paths)
