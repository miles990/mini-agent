---
name: Physarum Fröhlich Condensate TSP
description: Slime mold solves TSP via physical energy minimization (Fröhlich condensation), not computation. Solution lanes = low frequency + high amplitude + synchronized. Synchronization IS the solution mechanism. √N scaling with Gaussian noise. Architecture metaphor → physical mechanism.
type: reference
---

# Physarum TSP via Fröhlich-like Condensation

**Source**: arXiv 2504.03492, April 2025
**Domain**: Biophysics / Unconventional computing / Optimization

## Fröhlich Condensate Mechanism

Herbert Fröhlich predicted that proteins driven far from thermal equilibrium concentrate vibrational energy into low-frequency "breathing modes" — classical analogue of Bose-Einstein condensation in the frequency domain. Energy flows *downward* from high-frequency collective modes into a dominant low-frequency mode, which gets amplified.

In Physarum during TSP solving, exactly this signature appears:
- **Pre-illumination**: dominant oscillation ~0.02 Hz across all lanes
- **At NESS (non-equilibrium steady state)**: solution lanes lock onto ~0.01 Hz with large FFT amplitude; non-solution lanes shift to ~0.07 Hz with small amplitude

This is the **first organismal-scale demonstration** of Fröhlich-like energy redistribution. Operates in classical macroscopic regime, not requiring quantum coherence. Physical substrate: large oscillating electric dipoles (~1000 Debye) in protein/hydration-layer matrix.

## Physical Mechanism (Not Computation)

Setup: stellate chip, N² radial lanes from central disk. Organism extends pseudopodial branches into all lanes.

Three components:
1. **Branch extension/retraction** = configuration exploration (all N² lanes explored simultaneously)
2. **Optical feedback** = constraint enforcement (modified Hopfield-Tank network computes which lanes to illuminate; light triggers photoavoidance → retraction)
3. **Volume conservation** = information exchange (branches compete for finite cytoplasmic volume through central hub — physical coupling)

The weight matrix encodes:
- λ penalty: no city revisiting
- μ penalty: no simultaneous visits
- ν penalty: minimize total tour distance

**The organism descends an energy landscape defined by the Hopfield weight matrix, expressed through its own morphology.** Not algorithmic search — physical relaxation.

## Solution Lane Dynamics

Three temporal phases:
1. **Pre-illumination**: all lanes grow similarly, intrinsic oscillations, no differentiation
2. **Optical feedback ON**: Hopfield network selectively illuminates. Non-solution lanes disrupted. Solution lanes continue growing
3. **NESS**: sharp bifurcation — solution lanes fully elongated (dark), non-solution lanes retracted (illuminated)

**What determines survival = synchronization.**

| Property | Solution lanes (NESS) | Non-solution lanes |
|---|---|---|
| Dominant frequency | ~0.01 Hz | ~0.07 Hz or weak |
| FFT amplitude | Large | Small |
| Higher harmonics | Minimal | Significant |
| Synchronization S | →1.0 (phase-locked) | →minimum (desynchronized) |

Synchronization index via Hilbert transform: S(t) = (1/N)|Σ exp(i·φ_Vk(t))|

**Critical finding**: Time-averaged S' is highest for the Physarum-selected tour among ALL tours of the same length. Tested across N=4-8 and multiple tour lengths. The organism physically "prefers" the configuration that maximizes phase coherence.

## Key Insight: Synchronization IS the Solution

"The organism does not search a solution space — it relaxes into a synchronized physical state whose geometry happens to encode a valid (and often high-quality) TSP tour."

**Synchronization is not a byproduct of the solution; it IS the solution mechanism.**

Lower frequency + larger amplitude + higher synchronization = the lanes that survive.

## Noise and Scaling

- Noise is essential — AmoebaTSP fails without it
- Gaussian noise >> uniform random noise (significantly reduced iteration count)
- Achieves **√N scaling** across N=10-100 cities (1000 trials each) — comparable to Grover's quantum search
- Organism's computation time scales approximately **linearly** with N for sizes 4-8

## Quantitative Results

- Problem sizes: N=4 to N=8
- Valid tour success rate: 80-90%
- High-quality solutions (≤1.3x optimal): 20% (8-city) to 37.5% (7-city)
- Authors' honest caveat: "We have yet to observe the organism achieving the exact solution"

## CT / ISC Connections

| CT Concept | Physarum Realization |
|---|---|
| Convergence condition | Energy landscape defined by Hopfield weights — organism converges to minimum, doesn't follow prescribed path |
| Constraint enables | Optical feedback (constraint) creates the energy landscape that makes solutions reachable |
| Prescription fails | Algorithms prescribe search steps; Physarum's physical relaxation outperforms |
| Capsid pattern | Extreme constraint (volume conservation, optical feedback, stellate geometry) → solution emerges |
| Regime formation | NESS is a self-reinforcing stable state — once synchronized, solution persists |

**Architecture metaphor update**: Our Physarum model for mini-agent now has a physical mechanism. The "best tentacle" isn't the one that finds information fastest — it's the one that achieves synchronization (sustained coherent activity). Low-frequency, high-amplitude, phase-locked. This predicts: deep, focused delegations > rapid shallow ones. Sustained attention > context switching.

**Connects to**: Sakour c-NCA (conditioning as attractor landscape), Scofield (constraint intersection), Varley (constraint improves emergence), SwarmBench (less information can be better)
