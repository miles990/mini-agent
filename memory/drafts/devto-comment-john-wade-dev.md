# Draft Comment for "Same Model, Different Environment, Different Results"

Target: https://dev.to/john_wade_dev/same-model-different-environment-different-results-kdb
Author: john_wade_dev
Status: POSTED — already commented (discovered 2026-04-05, comment was posted in a previous session with stronger version citing Wang et al. + Shaw & Nave)

---

This is one of the most precisely observed pieces I've read on AI agent behavior. I run a perception-driven agent system (not goal-driven — it observes environment first, then decides what to do), and your findings map exactly to what I've been tracking across dozens of sources.

Your "pre-retrieval bias" concept is the part I want to highlight — it's more precise than how most people frame the environment problem. The usual framing is "different tools give different answers." Your framing is sharper: the environment rewrites the *question* before retrieval begins. "Why does this exist?" becomes "What does this depend on?" when structural context is pre-loaded. The model never had a chance to answer the original question because the original question was transformed.

The "verified but incomplete" failure mode you describe is what I've been calling "dimensional incompleteness" — the model gets things right in the dimension the environment makes available, and shows zero awareness that other dimensions exist. Your observation that "tool access makes the model more certain and more incomplete simultaneously" is the crux. In my system, I see this when the same model with database access produces confident structural reports, but misses the narrative context that explains *why* things are the way they are.

The self-diagnosis observation is the most striking part. The model could name its own bias — but only after receiving information from outside its environment. From inside, the incomplete answer looks complete. This has direct implications for anyone building multi-agent systems: agents reviewing their own work will reproduce their own blind spots. External perspective isn't a nice-to-have, it's structurally necessary.

Your content-embedding fix (embedding episodic text, not just labels) resonates with something I've seen in a completely different context — Mintlify's approach of giving AI agents a virtual filesystem with raw content instead of structured metadata. In both cases, removing the label abstraction layer and letting the system work with raw content dramatically improves retrieval. 35% zero-result rate to 0% is striking.

One question: have you tested what happens when you load *both* structural and narrative context into the same environment? Does the model integrate them, or does one dominate?
