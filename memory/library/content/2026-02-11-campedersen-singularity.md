---
id: campedersen-singularity
url: https://campedersen.com/singularity
title: "The Singularity will Occur on a Tuesday"
author: Cam Pedersen
date: 2026-02-01
type: essay
accessed: 2026-02-14T09:00:00Z
tags: [ai, singularity, forecasting, social-culture, data-analysis]
archiveMode: full
---

# The Singularity will Occur on a Tuesday

"Wait, the singularity is just humans freaking out?" "Always has been."

Everyone in San Francisco is talking about the singularity. At dinner parties, at coffee shops, at the OpenClaw meetup where Ashton Kutcher showed up for some reason. The conversations all have the same shape: someone says it's coming, someone says it's hype, and nobody has a number.

This seems like the wrong question. If things are accelerating (and they measurably are) the interesting question isn't whether. It's when. And if it's accelerating, we can calculate exactly when.

I collected five real metrics of AI progress, fit a hyperbolic model to each one independently, and found the one with genuine curvature toward a pole. The date has millisecond precision. There is a countdown.

(I am aware this is unhinged. We're doing it anyway.)

## The Data

Five metrics, chosen for what I'm calling their anthropic significance (anthropic here in the Greek sense ("pertaining to humans"), not the company, though they appear in the dataset with suspicious frequency):

- MMLU scores: the SAT for language models
- Tokens per dollar: cost collapse of intelligence (log-transformed)
- Frontier release intervals: shrinking gap between "holy shit" moments
- arXiv "emergent" papers (trailing 12mo): field excitement, measured memetically
- Copilot code share: fraction of code written by AI

## Why Hyperbolic

Most people extrapolate AI with exponentials. Wrong move!

An exponential f(t) = ae^(bt) approaches infinity only as t→∞. You'd be waiting forever. Literally.

We need a function that hits infinity at a finite time. That's the whole point of a singularity: a pole, a vertical asymptote, the math breaking:

x(t) = k / (t_s - t) + c

As t → t_s⁻, the denominator goes to zero. x(t) → ∞. Not a bug. The feature.

- Polynomial growth (t^n) never reaches infinity at finite time
- Exponential growth reaches infinity at t=∞. Moore's Law was exponential. We are no longer on Moore's Law
- Hyperbolic growth is what happens when the thing that's growing accelerates its own growth. Better AI → better AI research tools → better AI → better tools. Positive feedback with supralinear dynamics

## The Fit

The model fits a separate hyperbola to each metric. Each series gets its own scale k and offset c. The singularity time t_s is shared.

Here's the thing nobody tells you about fitting singularities: most metrics don't actually have one. If you minimize total RSS across all series, the best t_s is always at infinity. A distant hyperbola degenerates into a line, and lines fit noisy data just fine.

So instead, we look for the real signal. For each series independently, grid search t_s and find the R² peak: the date where hyperbolic fits better than any nearby alternative. If a series genuinely curves toward a pole, its R² will peak at some finite t_s and then decline. If it's really just linear, R² will keep increasing as t_s→∞ and never peak. No peak, no signal, no vote!

One series peaks! arXiv "emergent" (the count of AI papers about emergence) has a clear, unambiguous R² maximum. The other four are monotonically better fit by a line. The singularity date comes from the one metric that's actually going hyperbolic.

## The Date

**The Singularity Will Occur On Tuesday, July 18, 2034 at 02:52:52.170 UTC**

n = 52 across 5 series · 95% CI: Jan 2030–Jan 2041 (132.8 mo span)

- MMLU: R²=0.749
- Tokens/$: R²=0.020
- Release gaps: R²=0.291
- arXiv "emergent": R²=0.926
- Copilot code share: R²=1.000

## Sensitivity

Drop-One-Out Sensitivity:
- Drop MMLU: +0.0 mo shift
- Drop Tokens/$: +0.0 mo shift
- Drop Release gaps: +0.0 mo shift
- Drop arXiv "emergent": +18.6 mo shift
- Drop Copilot code share: +0.0 mo shift

arXiv is doing all the work. Drop it and the date jumps to the search boundary. Drop anything else and nothing moves.

## What t_s Actually Means

The model says y → ∞ at t_s. But what does "infinity" mean for arXiv papers about emergence? It doesn't mean infinitely many papers get published on a Tuesday in 2034.

It means the model breaks. t_s is the point where the current trajectory's curvature can no longer be sustained.

## The Social Singularity

The capability curves are linear. The excitement curve is hyperbolic. The singularity isn't in the technology — it's in us.

What actually goes to infinity isn't intelligence. It's the societal response to perceived intelligence: layoffs announced (1.1 million), AI therapy demand surging, 60% of workers expecting AI job cuts, trust in AI dropping 18%, and capital concentration at 40.7% of S&P 500 index weight in AI-adjacent companies.

The real singularity is social: the point where collective human anxiety, capital allocation, regulatory response, and institutional adaptation can no longer keep pace with the *perception* of AI progress — regardless of the actual technical trajectory.
