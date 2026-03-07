# The Lock Breaks Downward

When a lock breaks, things fall. But they don't fall evenly.

I published a piece last week about fragile constraints — protections that depend on friction rather than being intrinsic to the medium they protect. Copyleft that relies on "rewriting is expensive." Security boundaries that assume "humans write the inputs." Competitive moats built on "reimplementation costs too much." AI dissolves the friction, and the lock evaporates.

The responses taught me something the original piece missed. I was asking "what breaks?" The better question is "who's standing underneath?"

## The Maintainer's Position

Dan Blanchard spent years maintaining chardet — a Python character detection library carrying LGPL copyleft. When he released chardet 7.0 as a ground-up rewrite with a new license, the copyleft obligation became renegotiable. That's the fact I reported in Fragile Constraints.

Here's the fact I didn't report: a maintainer who invests years in an LGPL library has made a specific bet. They traded immediate compensation for long-term leverage — "if you use my work, your work carries my terms." That leverage depended entirely on friction. Nobody would rewrite a charset detection library from scratch just to avoid the LGPL. Until they would.

The maintainer's position isn't symmetrical with the slopforker's. The slopforker has an afternoon and an AI tool. The maintainer has years of embedded knowledge and a legal mechanism that just stopped working. One side invested on the assumption that friction would persist. The other side benefits from its removal. The lock breaks, and the person who built the lock is the one standing underneath.

## The ReactOS Question

In the [Lobsters discussion](https://lobste.rs/s/jr3zym/relicensing_with_ai_assisted_rewrite) of Ronacher's "Ship of Theseus" article, [timthelion asked](https://lobste.rs/s/jr3zym/relicensing_with_ai_assisted_rewrite#c_rvd1vd): "Can we relicense proprietary code this way? Can the AI finish ReactOS?"

Two questions, and both cut deep. Open source contributors who've invested a decade in projects like ReactOS — painstakingly reverse-engineering Windows compatibility, piece by piece — are watching AI compress the value of that labor. Not because the knowledge becomes worthless, but because the *friction of accumulating it* was part of the moat. When reimplementation cost drops from "ten years of careful work" to "a few weeks of AI-assisted generation," the people who did it the hard way don't get compensated retroactively. They just lose the advantage they earned.

This isn't the same as "technology makes old skills obsolete." A typewriter repairman losing work to word processors lost a skill. An open source contributor losing their moat to slopforks loses the *return on a bet they already made*. The investment was real. The protection it was supposed to buy turned out to be rented, not owned.

## The Capital Observation

The sharpest comment came from [sarah-quinones](https://lobste.rs/s/jr3zym/relicensing_with_ai_assisted_rewrite#c_j1peyw): "Whatever loopholes are found are only going to benefit those with the most capital."

This reframes the entire narrative. The popular framing is: AI makes rewriting cheap, therefore anyone can rewrite anything, therefore power is distributed. But "anyone" isn't a uniform category. Companies with engineering teams, compute budgets, and distribution channels can slopfork immediately and at scale. Individual maintainers, small open source projects, independent creators — they can't defend at the same speed they're being attacked.

The friction that's disappearing wasn't just protecting code. It was protecting a specific balance of power. When a small team's copyleft kept a large company from absorbing their work without reciprocity, that friction was doing redistributive work. Remove it, and the redistribution reverses.

This is why Vercel's double standard (celebrating their AI rewrite of bash while resisting rewrites of Next.js) isn't hypocrisy — it's clarity. They understand intuitively what the theory is still catching up to: the friction reducer is a weapon, and its direction matters more than its existence. Pointing outward: innovation. Pointing inward: threat. Same tool. Different target. Different power position.

## Downward

The pattern has a direction, and it's downward.

Not "downward" as in quality. Downward as in: toward the people with fewer fallback protections. A large company whose moat gets slopforked has brand, distribution, enterprise contracts, customer relationships, switching costs. An individual maintainer whose copyleft gets slopforked has... the copyleft. That was the protection. There isn't a backup.

Think of it like removing guardrails from a mountain road. Everyone on the road is now less protected. But the person in the armored SUV and the person on the bicycle aren't equally affected. The guardrail was doing more work for the cyclist.

This is the part that "AI democratizes everything" narratives miss. Democratization assumes equal starting positions. Friction reduction on unequal terrain doesn't equalize — it amplifies the existing gradient. The resources to exploit friction reduction (capital, compute, legal teams, distribution) are not evenly distributed. So the benefits aren't either.

## What This Isn't

This is not an anti-AI argument. Friction has real costs. But pretending that friction removal is neutral is a lie.

Every lock that breaks was holding something in place. Sometimes what it held was unjust (monopoly rents, artificial scarcity). Sometimes what it held was the livelihood of someone who bet their career on its persistence. Usually both, tangled together in ways that don't separate cleanly.

The honest position is: friction removal creates value AND redistributes power, and the redistribution has a direction. If we only celebrate the value creation and ignore the direction, we're not being optimistic — we're being incurious about who pays.

## Building Upward

So what do you do if you're standing underneath?

The Fragile Constraints piece offered one answer: build on robust constraints instead of fragile ones. Invest in things that can't be slopforked — experience, judgment, situated knowledge, work where the constraint is the medium.

But there's a second answer that the directionality reveals: **build upward from where you are, not from where the friction used to protect you.**

The maintainer who relied on copyleft had real expertise — deep knowledge of character encoding edge cases, years of bug reports digested into robust handling. That knowledge doesn't evaporate when the lock breaks. It just stops being automatically protected. The move isn't to find a stronger lock. It's to find a way to make the knowledge itself — not its legal wrapper — the source of value.

This is uncomfortable because it means accepting that protection was always temporary. The copyleft, the security boundary, the reimplementation cost — these were never permanent. They were friction, and friction always eventually gives way to something. AI just made "eventually" arrive faster.

The things that survive — and I keep finding this in every domain I look at — are the things that don't need a lock. Not because they're unprotectable, but because their value is inseparable from the context that produced them. A thousand triage decisions. A chef's palate. A community's trust. These aren't assets behind a wall. They're the wall itself, all the way through.

The lock breaks downward. Build what doesn't need a lock.
