---
name: Sakour Conditional Morphogenesis NCA
description: Same NCA rules + different conditioning vector = different morphologies. 10,048 params produce 10 stable forms (96.3% accuracy). Conditioning biases local perception, not prescribes output. 300x fewer params than DCGAN. Emergent self-repair without training. CT biological instantiation.
type: reference
---

# Conditional Morphogenesis via Neural Cellular Automata

**Source**: Ali Sakour, arXiv 2512.08360, December 2025
**Domain**: Developmental biology / Neural Cellular Automata / Morphogenesis

## Core Mechanism

A single 10,048-parameter update rule (two 1x1 convolutions, hidden dim 128) operates identically across all 28x28 cells. Each cell has 4 visible (RGBA) + 12 hidden "chemical memory" channels. Cells perceive their Moore neighborhood via a learnable 3x3 depthwise convolution.

**Conditioning**: A one-hot class vector c in {0,1}^10 is spatially broadcasted to every cell at every timestep and concatenated to the perception vector. This persistent per-timestep signal is analogous to a morphogenetic gradient in biology.

**Key distinction from StampCA**: StampCA encodes condition only in the initial seed (then loses it). c-NCA provides persistent conditioning — the "chemical signal" is always present.

## Development Stages

1. **Common ancestry (t=0 to ~8)**: All digits start from single active pixel. Expansion is near-isotropic — circular blob regardless of class.
2. **Symmetry breaking (t=8 to ~24)**: Condition vector biases update network output toward class-specific asymmetric solutions. Without conditioning, system maintains radial symmetry.
3. **Refinement (t=32 to 64)**: Boundaries sharpen, pattern converges to stable attractor for that digit class.

## Quantitative Results

| Metric | Value |
|---|---|
| Classification accuracy (LeNet-5) | 96.30% |
| Mean classifier confidence | 94.76% |
| Structural stability MSE (t=64→128) | 0.0297 (homeostasis) |
| SSIM vs test set | 0.4826 (canonical forms, not memorization) |
| Total parameters | 10,048 (vs ~3M for DCGAN = 300x fewer) |
| Distinct morphologies | 10 (MNIST digits) |

## Emergent Properties (Not Explicitly Trained)

- **Self-repair**: After 50% pixel dropout at t=64, near-perfect reconstruction within 48 steps
- **Robustness paradox**: Complex topologies ('8') more stable than simple ones ('1') — structural mass absorbs perturbation
- **Stochastic necessity**: Bernoulli mask p=0.5 critical — deterministic updates produce ghosting/blur. Asynchrony enforces sharp boundaries.

## CT Mapping (Constraint Texture)

| CT Concept | NCA Realization |
|---|---|
| Same model | Single 10,048-param update rule |
| Different constraint configurations | 10 different one-hot condition vectors |
| Different cognitive outcomes | 10 distinct morphological attractors |
| Constraint ≠ prescription | Vector doesn't dictate pixels; biases local perception interpretation |
| Emergence from local rules | No global orchestrator; 28x28 cells with 3x3 receptive fields |
| Constraint enables, not restricts | Without conditioning → only isotropic blobs |
| Self-repair = attractor robustness | Emergent from landscape, not trained |

**Core ISC insight**: The condition vector is NOT a blueprint/template (prescription). It modulates HOW cells interpret their neighbors. The global form is an emergent consequence of locally-biased interactions. 300x parameter efficiency comes from letting emergence do the computational work that centralized architectures must do with brute-force parameterization.

**Connects to**: Capsid pattern (extreme constraint → emergence), Prescription vs CC (conditioning = CC not prescription), Regime formation (stable attractors resist perturbation)
