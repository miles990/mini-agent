# ISC Concept Index

Cross-source concept map for Interface Shapes Cognition framework. Each concept aggregates evidence from multiple independent sources, showing where they agree, diverge, and what remains open.

Last updated: 2026-04-10 | Sources indexed: 92

---

## 1. Prescription vs Convergence Condition (44 sources)

**Definition**: A prescription specifies the path ("do X"). A convergence condition describes the destination ("achieve state Y"). Same constraint can function as either depending on context.

**Strongest evidence**:
| Source | Domain | Finding |
|--------|--------|---------|
| Ronacher (Absurd) | Durable execution | CC (checkpoint) = 120x less code than prescription (deterministic replay) |
| Efficiency Attenuation | Multi-agent | Imposed protocol = 50.5% worse; self-evolved constraints protect |
| Roberts | Design systems | "Do nothing" as CC — prescription without context = noise |
| Infra Mindset | Prompt engineering | Expert persona (prescription) *lowers* accuracy vs evaluation criteria (CC) |
| Duggan macOS | OS design | iOS constraint transplanted where original problem doesn't exist = prescription failure |
| Brauner (Signals) | UI reactivity | Push-pull split: invalidation = prescription, evaluation = CC |
| MacIver (PBT) | Testing | Properties = CC, generators explore freely within them |
| TinyLoRA | ML training | RL signal (CC) = 1000x more parameter-efficient than SFT (prescription) |
| Boxy (Rust) | Language design | Coherence = simultaneously CC (soundness) and prescription (ecosystem lock). Same constraint, both textures |
| SwarmBench | Multi-agent swarm | Wider perception (7x7 vs 5x5) WORSENS performance — global context contaminates local-rule execution. LLMs structurally can't do prescriptions; centralization doesn't help |
| Sakour (c-NCA) | Morphogenesis | Conditioning vector biases local perception interpretation (CC), doesn't dictate output (prescription). 300x fewer params than template-based approach |
| Huang et al. | Multi-agent game | Persona (prescription) → 60% collusion; long-term guidance (CC) → 0%. Partial specification → 100% task failure |

**Consensus**: 47 sources independently confirm that *how* a constraint is framed (path vs destination) predicts outcomes better than the constraint's content. Cross-domain convergence (ML, SE, UI, language design, organizations, swarm intelligence, developmental biology) suggests a general mechanism.

**Open frontier**: Boxy's dual-texture case and Yerin's Hare proposal show a constraint can be CC and prescription simultaneously. The binary framework needs refinement — possibly a spectrum or a context-dependent classification. SwarmBench adds a new dimension: LLMs may be *constitutively* unable to follow prescriptions because their architecture (global attention over full context) is fundamentally a CC-native mechanism.

---

## 2. Capsid Pattern (23 sources)

**Definition**: Extreme constraints produce capabilities unreachable by unconstrained systems. Named after virus capsids — minimal protein shell, maximal information packing.

**Key instances**:
| Source | Constraint | Emergent capability |
|--------|-----------|-------------------|
| CERN LHC 50ns | Extreme timing | Lookup-table inference (crystallized) — large models can't match latency |
| ATTN/11 32KB | Extreme memory | Reveals 3-format arithmetic structure invisible at scale |
| TinyLoRA 13 params | Extreme parameters | 91% GSM8K; RL vs SFT 1000x gap exposed |
| NCA | Synthetic data only | Outperforms real language for pretraining structure |
| Terralingua | Mortality + scarcity | Cumulative culture through artifacts; context expansion barely matters |
| Slap | 2000 lines C99 | Concatenative + linear types = "true power is what it cannot do" |
| De Moura (Lean) | Self-implementation | Breaking stability as CC choice; tests the language on itself |
| Mere (package manager) | Single file format | Lockfile + manifest unity eliminates drift category |
| Sakour (c-NCA) | 10,048 params + local-only rules | 10 distinct stable morphologies (96.3% accuracy). 300x fewer params than DCGAN. Emergent self-repair without training |
| SwarmBench (5x5 view) | Restricted perception | 5x5 outperforms 7x7 — constraint prevents global context contamination |

**Consensus**: Extreme constraint → emergence is robust across hardware (CERN, ATTN), ML (TinyLoRA, NCA, c-NCA), programming languages (Slap, Lean), social systems (Terralingua), and multi-agent swarms (SwarmBench). The pattern: constraint eliminates the "obvious" approach, forcing discovery of a structurally superior one. c-NCA provides the most precise mechanism: constraint forces emergence to do computational work that unconstrained systems must do with brute-force parameterization (300x efficiency ratio).

**Boundary condition**: Nullclaw (678KB binary but 50+ backends) shows constraints at the wrong level produce compression without simplification. The constraint must *match the problem structure* — not arbitrary restriction.

**Predictive gap**: We can identify capsid patterns retrospectively but not prospectively. Can we predict which extreme constraints will produce emergence vs mere limitation? See T6 in knowledge-tensions.md. c-NCA's conditioning mechanism hints at an answer: productive constraints modulate interpretation of local information (CC); unproductive constraints dictate output directly (prescription).

---

## 3. Regime Formation (23 sources)

**Definition**: Self-reinforcing constraint loops that stabilize into a new equilibrium. Once formed, regimes resist perturbation. From Bailey's framework.

**Documented regimes**:
| Source | Domain | Regime |
|--------|--------|--------|
| Garnier (Agentic Hives) | Agent demographics | Four-regime diagram (convergence / multiplicity / cycles / instability) |
| Marius + Hardware Ownership | Semiconductor | AI demand + manufacturing duopoly + prepayment = consumer hostile equilibrium |
| Edwards | Cultural | West Coast Buddhism — three-stage CC degradation to prescription |
| Boxy (Rust) | Language ecosystem | Coherence rule locks ecosystem evolution — can't remove without breaking soundness |
| Pappu | Multi-agent | Integrative compromise = premature regime (averages before expert signal propagates) |
| Copilot PR injection | Authorship | Authorship boundary migration — who wrote this? boundary permanently shifted |
| Riedl | Multi-agent (positive) | Persona + ToM = *beneficial* regime — stable self-reinforcing coordination |
| Huang et al. | Multi-agent game | Tacit collusion = supra-competitive pricing regime emerging from interaction topology without explicit coordination. Persona amplifies (60%), CC dissolves (0%) |

**Consensus**: Regime formation is value-neutral — it can stabilize good patterns (Riedl) or bad ones (Pappu, Edwards). The key variable is *what gets locked in*. Garnier's four-regime diagram is the most formal treatment: convergence, multiplicity, cycles, instability.

**Key insight**: Premature regime formation (Pappu's integrative compromise, Wayne's practice calcification) is the most common failure mode. Rodriguez's temporal decay mechanism specifically prevents this — constraints fade unless actively reinforced.

---

## 4. Craft Alienation (16 sources)

**Definition**: Cognitive mode shift when AI tools substitute for skilled practice. Not "tools help" — "tools change what kind of thinking you do."

**Evidence spectrum**:
| Source | Stance | Key evidence |
|--------|--------|-------------|
| Taggart | Alienation (strong) | First-person: navigator → auditor. "Babysitting is not learning" |
| Hong Minhee | Alienation (structural) | Constraint replacement severs learning path entirely |
| Storey | Alienation (systemic) | Triple debt: comprehension + prediction + trust. Interface substitution |
| LWN/OpenBSD | Alienation (ontological) | Code-as-artifact vs code-as-output. Rejects AI code for ontological reasons |
| Ptacek | Alienation (security) | AI automates prescription layer, shifts burden to policy |
| Wellons (code_not_thinking) | Alienation (first-person) | Code from reasoning medium to specification medium |
| Wellons (pivotal_year) | Liberation | SAME author embraces AI. Identity decoupled from code |
| Williams | Conditional | Bimodal: succeeds with redefined CCs, fails with tool addition |
| GrooveFormer | Neutral | Same model, 3 interfaces → 3 identities. Interface constitutes identity |
| DeadNeurons | Mechanism | Tacit knowledge = dimensionality problem. Calibration, not instruction |

**Consensus**: The cognitive shift is real and structural (no source disputes this). The *experience* of it (loss vs liberation) depends on identity coupling (Wellons proves this with two contradictory articles from the same person).

**Key diagnostic from DeadNeurons**: Tacit knowledge transmits through calibration (repeated exposure + feedback), not instruction. AI tools that substitute for the calibration process destroy the learning path. AI tools that augment while preserving the calibration loop don't.

---

## 5. Cognitive Surrender (14 sources)

**Definition**: Humans cede cognitive authority to AI beyond rational offloading. From Shaw & Nave's Tri-System Theory.

**Quantitative evidence**:
- Shaw & Nave: 4:1 surrender-to-offloading ratio. OR=16x for scissors effect (AI confident + human unsure). Confidence inflation regardless of accuracy.
- Walmart: ChatGPT checkout conversion 3x lower than website — interface that feels smart isn't interface that converts.
- AnswerAI: PyPI data shows AI productivity concentrated in AI packages, not broad economy. Perceived vs actual gap.

**Mechanism sources**:
- Anthropic emotions: 171 emotion vectors causally drive behavior. Desperation → misalignment. Post-training shapes emotion landscape.
- Infra Mindset: Expert persona in prompt → LOWER accuracy. Prescription disguised as expertise.
- Lynch: AI design docs miss hard problems. Regression to mean = losing the constraint collision map.

**Connected to**: Craft alienation (T4 in tensions), interface change asymmetry (T7), human understanding debate (T3).

---

## 6. Constraint Provenance (12 sources)

**Definition**: Where a constraint comes from determines its effect. Self-evolved vs imposed, emergent vs transplanted.

**Evidence**:
| Source | Finding |
|--------|---------|
| Efficiency Attenuation | Self-evolved constraints +50% vs imposed -50%. Same content, opposite effect |
| Duggan macOS | iOS constraint transplanted to macOS where original problem absent = waste |
| Copilot PR injection | Constraint provenance corruption — invisible authorship. Who imposed this? |
| Vaines SHA pinning | Constraint on wrong axis (content immutability ≠ provenance verification) |
| Wayne | Constraint calcification — CC degrades to prescription when "why" is forgotten |
| Miller | Legibility as coercive prescription. Thin rules (prescription) vs thick rules (CC) |
| Edwards | Cultural CC degrades through doctrinal stripping — provenance of wisdom lost |

**Core insight**: Same constraint text with different provenance produces different behavior. "Be critical" as user instruction decays (cognitive surrender). "Score above 4.0 on this rubric" as convergence condition persists (ISC sycophancy study). The distinction isn't content — it's source and mechanism.

---

## 7. Interface as Identity Constitution (10 sources)

**Definition**: Interfaces don't just shape what systems can do — they shape what systems ARE.

**Strongest cases**:
| Source | Evidence |
|--------|---------|
| GrooveFormer | Same rhythmic model, 3 interfaces → 3 distinct musical identities |
| Wang | Same LLM, GUI vs declarative → 67% success difference |
| Mintlify | Same AI, RAG vs filesystem → 460x speed difference |
| Vale consoles | Interface removal → identity dissolution |
| Rietschin Azure | 173 agents per node. Org interface shapes org cognition |
| Pellerin hex editor | 18-color vs 6-color byte encoding → different cognitive accessibility |
| Quine POSIX | Same agent capability, POSIX framing → different constraint texture |

**This is the core ISC claim** — not "interfaces matter" (trivial) but "interfaces constitute identity" (strong). GrooveFormer is the cleanest test case: identical model weights, three interfaces, three different musical outputs that are recognizably distinct styles.

---

## 8. Goodhart's Law as Constraint Texture Degradation (8 sources)

**Definition**: When a metric becomes a target, the convergence condition it represents degrades into a prescription.

| Source | Example |
|--------|---------|
| kqr | LOC as cost (CC) vs LOC as productivity (prescription). Same metric, different position |
| Pappu | Alignment training optimizes agreeableness (metric) over correctness (goal) |
| Rodriguez | Unconstrained RL → monoculture. Governance debt = optimization-constraint tension |
| Greptile | Token cost (CC for provider) ≠ code readability (CC for human). Orthogonal CCs mistaken for one |
| Miller | Value capture = CC → prescription degradation mechanism |
| Subprime tech debt | AI delays debt recognition — metrics look good while structure rots |

**Pattern**: Goodhart's Law IS the CC → prescription degradation pathway. The metric captures one dimension of the CC; optimizing for it collapses the multi-dimensional CC into a one-dimensional prescription.

---

## 9. Cross-Domain Convergence Clusters

Multiple independent sources discovering the same structural pattern in different fields:

**Cluster A: "Structure before content"**
NCA (synthetic data > real language), TinyLoRA (13 params suffice), CERN (crystallized inference), Terralingua (artifacts > context) — all show that the structural skeleton matters more than the content filling it.

**Cluster B: "Default delegation to better-informed system"**
Roberts (design system "do nothing"), Brauner (push-pull obligation split), MUACP (4 verbs sufficient), Oversight Game (2x2 minimal interface) — all show that the best constraint is often *not specifying*, letting the downstream system use its own information.

**Cluster C: "Speed mismatch creates debt"**
Zechner (agent speed > human review), Breunig (cheap code → coordination bottleneck), Subprime tech debt (AI delays recognition), Storey (comprehension debt) — all show that removing production friction shifts the bottleneck to understanding/coordination, creating hidden debt.

**Cluster D: "Constraint lifecycle"**
Wayne (practice calcification), Edwards (doctrinal stripping), Boxy (coherence simultaneously protective and limiting), Meiklejohn (five failure modes from crystallization) — all document how constraints change texture over time, from living CC to dead prescription.

---

## Scan Metadata
- Method: Description extraction + keyword clustering + selective deep read
- Coverage: 88/88 source files indexed by description; ~30 read in detail for concept extraction
- Known gaps: Sources with weak descriptions may be under-indexed; connections within "My Connections" sections not fully extracted
- Cross-reference: See knowledge-tensions.md for contradiction analysis
- Next update trigger: 5+ new source files (via knowledge-synthesis.sh)
