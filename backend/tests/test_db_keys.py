import re
from services.db.keys import mint_key

def test_mint_key_shape():
    k = mint_key()
    assert len(k) == 8
    assert re.fullmatch(r"[0-9A-Za-z]{8}", k)

def test_mint_key_unique():
    assert len({mint_key() for _ in range(10_000)}) == 10_000
