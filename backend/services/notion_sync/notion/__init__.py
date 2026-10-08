"""The Notion anti-corruption layer (ROBUSTNESS §2).

This package, and only this package, knows Notion's URL, headers, JSON shapes,
limits and error codes. `test_no_notion_shapes_outside_adapter` enforces it.
"""
