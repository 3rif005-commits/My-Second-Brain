"""What "everything" includes (decision D5): the Settings switches."""
DEFAULT_INCLUDE = {"collections": True, "notes": True, "databases": True, "embedded_files": True,
                   "source_files": False, "threads": False, "skills": False}


def include_of(conn) -> dict:
    return {**DEFAULT_INCLUDE, **(conn.row.get("include") or {})}
