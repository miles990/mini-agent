# task-queue-hygiene

- [2026-04-24] [2026-04-24 cycle #93] Re-tested task-queue abandon op after cycle #79 claim failed verification. 5 duplicates (c697b93a/1c4e888d/f5b40b70/9bb94199/6fed2b52), canonical=ac5c54f9. Falsifier locked: next cycle snapshot must not contain these IDs in in_progress/pending. If still present → update handler doesn't process abandoned status → grep src/ for dispatcher update path.
