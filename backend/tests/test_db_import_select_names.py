"""CSV import stores select values as option NAMES, like every other select write in the app.
It stored option ids, so imported tables showed "UE1lkFAU" where "Done" was meant (found on the
deployed site). Pure unit test: no database needed."""
import pytest

from routers.db_import import _wrap_value, infer_column


def test_imported_select_cells_hold_the_option_name():
    inf = infer_column(["Done", "Reading", "Done", "To read"])
    assert inf.inferred_type == "select"
    assert {o["name"] for o in inf.config["options"]} == {"Done", "Reading", "To read"}
    assert _wrap_value("select", "Done", inf.value_to_option_id) == {"type": "select", "select": "Done"}


def test_a_value_without_an_option_is_a_bug_not_a_silent_write():
    inf = infer_column(["a", "b", "a"])
    with pytest.raises(RuntimeError):
        _wrap_value("select", "zzz", inf.value_to_option_id)
