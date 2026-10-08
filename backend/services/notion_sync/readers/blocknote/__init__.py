def load_all() -> None:
    """Import every reader module so each registers itself."""
    from services.notion_sync.readers.blocknote import (  # noqa: F401
        code, divider, lists, text, unknown)
