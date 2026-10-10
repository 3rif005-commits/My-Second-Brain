"""python -m tools.backup --out ~/SecondBrainBackups/now.sbz [--user <uuid>]  — write a backup archive."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from services.backup import archive


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--user", help="user id (default: the only user)")
    args = ap.parse_args()
    from services.database import get_supabase
    from services.backup.runner import default_skill_dirs, only_user
    db = get_supabase()
    user = args.user or only_user(db)
    from services.workspace import storage
    m = archive.build(db, user, args.out, storage_download=storage.download, skills_dirs=default_skill_dirs())
    problems = archive.verify(args.out)
    print(f"wrote {args.out}  ({args.out.stat().st_size:,} bytes)  counts={m['counts']}  problems={len(m['problems'])}")
    if problems:
        print("VERIFY FAILED:", *problems, sep="\n  ")
        sys.exit(1)


if __name__ == "__main__":
    main()
