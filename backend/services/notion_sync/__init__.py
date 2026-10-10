"""Send to Notion: push-only mirror (docs/notion-sync/).

readers/  ours -> IR     (never import notion/)
notion/   the ONLY package that knows Notion (adapter, writers, limits)
engine/   the frozen core: identity map, create protocol, runs
planner.py  dry run
"""
