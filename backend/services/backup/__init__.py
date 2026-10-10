"""The local backup archive (.sbz): the backup of record, independent of Notion (ADR-10).

`archive.build` writes it, `archive.verify` checks it, `restore.plan`/`restore.apply` read it back,
`retention.prune` keeps 7 daily + 4 weekly + 12 monthly.
"""
