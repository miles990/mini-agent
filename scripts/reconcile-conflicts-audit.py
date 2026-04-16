#!/usr/bin/env python3
"""
Reconcile conflicts.jsonl against resolution-audit.jsonl.

Finds three classes of mismatch identified in
memory/topics/kg-conflict-audit-2026-04-17.md:
  1. Winner mismatch (resolution_winner vs after.resolved_type)
  2. Rule label mismatch (resolution_rule vs after.rule)
  3. Missing entries (id present in one file but not the other)

Output: machine-readable JSON to stdout, human summary to stderr.
"""
import json
import sys
from pathlib import Path

ROOT = Path("/Users/user/Workspace/mini-agent/memory/index")
CONFLICTS = ROOT / "conflicts.jsonl"
AUDIT = ROOT / "resolution-audit.jsonl"


def load_jsonl(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def main():
    conflicts = {c["id"]: c for c in load_jsonl(CONFLICTS)}
    audit = {a["conflict_id"]: a for a in load_jsonl(AUDIT)}

    all_ids = sorted(set(conflicts) | set(audit))
    report = {
        "totals": {
            "conflicts": len(conflicts),
            "audit": len(audit),
            "union": len(all_ids),
        },
        "winner_mismatch": [],
        "rule_mismatch": [],
        "missing_in_audit": [],
        "missing_in_conflicts": [],
        "agree": [],
    }

    for cid in all_ids:
        c = conflicts.get(cid)
        a = audit.get(cid)
        if c is None:
            report["missing_in_conflicts"].append(cid)
            continue
        if a is None:
            report["missing_in_audit"].append(cid)
            continue

        c_winner = c.get("resolution_winner")
        a_winner = (a.get("after") or {}).get("resolved_type")
        c_rule = c.get("resolution_rule")
        a_rule = (a.get("after") or {}).get("rule")

        winner_ok = (
            c_winner == a_winner
            or (isinstance(c_winner, list) and a_winner in c_winner)
            or (isinstance(a_winner, list) and c_winner in a_winner)
        )
        rule_ok = c_rule == a_rule

        row = {
            "id": cid,
            "entity": c.get("entities", [None])[0],
            "conflicts_winner": c_winner,
            "audit_winner": a_winner,
            "conflicts_rule": c_rule,
            "audit_rule": a_rule,
        }
        if not winner_ok:
            report["winner_mismatch"].append(row)
        if not rule_ok:
            report["rule_mismatch"].append(row)
        if winner_ok and rule_ok:
            report["agree"].append(cid)

    print(json.dumps(report, indent=2, ensure_ascii=False))

    s = sys.stderr
    print("=" * 60, file=s)
    print(f"Reconciliation: {CONFLICTS.name} vs {AUDIT.name}", file=s)
    print("=" * 60, file=s)
    print(f"  conflicts.jsonl       : {report['totals']['conflicts']} rows", file=s)
    print(f"  resolution-audit.jsonl: {report['totals']['audit']} rows", file=s)
    print(f"  union of IDs          : {report['totals']['union']}", file=s)
    print(f"  fully agree           : {len(report['agree'])}", file=s)
    print(f"  winner mismatches     : {len(report['winner_mismatch'])}", file=s)
    print(f"  rule mismatches       : {len(report['rule_mismatch'])}", file=s)
    print(f"  missing in audit      : {len(report['missing_in_audit'])}", file=s)
    print(f"  missing in conflicts  : {len(report['missing_in_conflicts'])}", file=s)
    if report["missing_in_audit"]:
        print(f"    -> {report['missing_in_audit']}", file=s)
    if report["missing_in_conflicts"]:
        print(f"    -> {report['missing_in_conflicts']}", file=s)


if __name__ == "__main__":
    main()
