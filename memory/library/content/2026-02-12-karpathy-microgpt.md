---
id: karpathy-microgpt
url: https://karpathy.github.io/2026/02/12/microgpt/
title: "microgpt: the simplest GPT"
author: Andrej Karpathy
date: 2026-02-12
type: blog
accessed: 2026-02-14T09:00:00Z
tags: [ai, gpt, minimalism, deep-learning, distillation]
archiveMode: metadata-only
---

Karpathy's ten-year distillation journey: micrograd → makemore → nanogpt → microgpt. A 200-line pure Python, zero-dependency, complete GPT implementation. 4,192 parameters. Tokenizer + autograd (Value class) + transformer + Adam optimizer + training + inference all included.

Key insights:
- "Everything else is just efficiency" — the algorithm's essence doesn't change with scale
- Called it an "art project" not a teaching tool — distillation itself has aesthetic value
- Training shows explicit KV cache + backprop through cache — reveals cache was always there, just hidden by efficiency
- "No magic" — but scale may change essence not just degree

Structural parallels: mini-agent 3K lines vs AutoGPT 181K lines follows the same minimalist aesthetic. NetNewsWire's "simplicity = longevity" principle applies. GLM-5 scaling paradigm is the orthogonal direction (scale algorithm vs scale context).
