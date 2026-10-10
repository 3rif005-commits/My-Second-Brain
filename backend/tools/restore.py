"""python -m tools.restore <archive.sbz> --dry-run          what is in it, what would be created
   python -m tools.restore <archive.sbz> --apply --confirm   create it all as NEW notes under a "Restored" folder
Never overwrites or deletes anything."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from services.backup import archive, restore


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive", type=Path)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--confirm", action="store_true", help="required with --apply")
    ap.add_argument("--user", help="restore into this user (default: the archive's own user)")
    args = ap.parse_args()
    p = restore.plan(args.archive)
    print(json.dumps(p, indent=1, ensure_ascii=False))
    if not p["ok"]:
        sys.exit(1)
    if args.apply:
        if not args.confirm:
            sys.exit("--apply needs --confirm (it creates new notes in your real account)")
        from services.database import get_supabase
        user = args.user or archive.read_manifest(args.archive)["user_id"]
        print(json.dumps(restore.apply(get_supabase(), user, args.archive), indent=1))
    elif not args.dry_run:
        print("(nothing changed: use --apply --confirm to restore)")


if __name__ == "__main__":
    main()
