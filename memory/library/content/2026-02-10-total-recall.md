---
id: total-recall
url: https://github.com/davegoldblatt/total-recall
title: "Total Recall: Persistent Memory Plugin for Claude Code"
author: Dave Goldblatt
date: 2025-01-01
type: docs
accessed: 2026-02-14T09:00:00Z
tags: [ai, memory-management, claude-code, write-gate, agent-architecture]
archiveMode: metadata-only
---

Total Recall is a persistent memory plugin for Claude Code featuring a tiered memory system, write gates (five-question filter before storing), correction propagation (updating related information when facts change), daily-first delayed promotion, and slash commands for memory management.

Key concepts referenced in mini-agent research:
- Write-gated memory: Five questions before storing prevents memory bloat
- Daily-first delayed promotion: New information starts in daily notes, gets promoted to long-term only after proving value
- Contradiction handling: `[superseded]` markers instead of deletion
