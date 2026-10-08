from services.portable import ir
from services.portable.canonical import canonical, digest
from services.portable.losses import Loss, dedupe, fidelity


def test_canonical_is_stable_across_key_order():
    assert canonical({"b": 1, "a": [1, 2]}) == canonical({"a": [1, 2], "b": 1})
    assert digest({"b": 1, "a": 2}) == digest({"a": 2, "b": 1})


def test_digest_changes_with_content_and_parts_are_separated():
    assert digest("ab", "c") != digest("a", "bc")
    assert digest({"x": 1}) != digest({"x": 2})


def test_canonical_keeps_unicode():
    assert "é😀" in canonical({"t": "é😀"})


def test_block_to_dict_omits_empty_and_is_json_ready():
    b = ir.Block("paragraph", inline=[ir.Text("hi", {"bold": True})], src_id="1")
    assert b.to_dict() == {"type": "paragraph", "inline": [
        {"type": "text", "text": "hi", "marks": {"bold": True}}], "src_id": "1"}


def test_obj_carries_ir_version():
    o = ir.Obj("page", ir.Ref("note", "n1"))
    assert o.to_dict()["ir_version"] == ir.IR_VERSION == 1


def test_fidelity_words():
    assert fidelity([]) == "exact"
    assert fidelity([Loss("approximated", "a", "b", "c")]) == "approximated"
    assert fidelity([Loss("approximated", "a", "b", "c"),
                     Loss("impossible", "a", "b", "d")]) == "lossy"


def test_loss_rejects_unknown_level():
    import pytest
    with pytest.raises(ValueError):
        Loss("bad", "a", "b", "c")


def test_dedupe():
    a = Loss("lossy", "x", "y", "c")
    assert dedupe([a, a]) == [a]
