---
id: deobald-llm-problem
url: https://deobald.ca/essays/2026-02-10-the-problem-with-llms/
title: The Problem With LLMs
author: Steven Deobald
date: 2026-02-10
type: essay
accessed: 2026-02-12T10:30:00Z
tags: [ai, ethics, buddhism, programming, open-source]
archiveMode: full
---

# The Problem With LLMs

**Steven Deobald** | Feb 11, 2026 | 14 min read

## Premise

Six months ago, a friend of mine, with whom I work on the nonprofit Pariyatti mobile app, sent me this blog post by Vijay Khanna: From Idea to App in 7 Hours. By now, this is a fairly common zero-to-one LLM coding story. (LLM is short for Large Language Model but for the purposes of this essay, we'll use it as a substitute for what is broadly categorized as "generative AI" in early 2026. These systems are trained on large bodies of text, images, video, etc., which enable them to produce meaningful responses when prompted.)

The question was posed: could this help us implement new features in the Pariyatti app more quickly?

Indeed it could. But there are ethical concerns to consider before diving into the deep end with LLMs and, unfortunately, they aren't simple concepts to contend with.

Pariyatti's nonprofit mission, it should be noted, specifically incorporates a strict code of ethics, or sila: not to kill, not to steal, not to engage in sexual misconduct, not to lie, and not to take intoxicants.

In this conversation, two of these sila are of interest to us.

## Ethics

The fundamental ethical issue with LLMs is plagiarism. LLMs are, by their very nature, plagiarism machines. In the early days of GitHub Copilot, back before the Copilot brand was subsumed by the Microsoft juggernaut and the cute little sopwith flying helmet-plus-goggles logo was replaced with meaningless rainbow tilde, it would sometimes regurgitate training data verbatim. That's been patched in the years since, but it's important to remember a time -- not that long ago -- that the robots weren't very good at concealing what they were doing.

As a quick aside, I am not going to entertain the notion that LLMs are intelligent, for any value of "intelligent." They are robots. Programs. Fancy robots and big complicated programs, to be sure -- but computer programs, nonetheless. The rest of this essay will treat them as such. If you are already of the belief that the human mind can be reduced to token regurgitation, you can stop reading here. I'm not interested in philosophical thought experiments.

Plagiarism requires two halves. The first half of plagiarism is theft. Taking something which is not one's own. It's that peculiar kind of theft where the victim may not even know they're being stolen from: copyright violation. The second half is dishonesty. Plagiarism requires that the thief take the stolen work and also lie about its origins. Most plagiarists make minor modifications but all plagiarists pass the borrowed work off as their own.

LLMs do both of these things.

LLMs need to eat and to eat they need to steal. Their entire existence is predicated on the theft of copyrighted works and your usage of LLMs is predicated on your willingness to consume pirated work. If it matters to you, these are not exclusively the copyrighted works of large corporations or universities. Especially in the case of source code, it is often the work of individuals. And in the case of open source, that work tends to be licensed in a way that is incompatible with LLM training. LLMs break source code licensing. In the case of text, graphics, audio, and film, the work includes struggling artists. Realistically, other than those few artists who sell burned CDs out of the trunks of their cars to keep their work off the internet completely, it includes every struggling artist.

When you use an LLM, the product of that use is, inherently, a lie. It conceals the trillions of documents it used as source material. And if you claim its output as your own, you not only pander to the lie -- you give it a home in your heart.

If you wouldn't watch a torrented movie or read a downloaded e-book or listen to "borrowed" MP3s, you shouldn't be using LLMs.

Because I am not in the category of people who adhere strictly to copyright, I've been experimenting with LLMs for a month. But the lies we tell ourselves are more insidious than a willingness to dip our toes into grey-area theft. Of these two ethical quagmires, the lies concern me the most.

## The Positive

Before we get to my concerns, I'm going to praise LLMs for the benefits I have witnessed. I haven't seen these arguments made anywhere else, surprisingly, so I hope they are useful to at least a few people.

First, LLMs create accessibility in foreign languages. This is actually the one place we have used LLMs, historically, in the Pariyatti app. Translators are busy and find it easier to review translations than to translate huge CSV files. Even before the ubiquity of programming agents, another volunteer has been translating the UI and content of the Pariyatti app with LLMs. This serves users who would be otherwise unable to read the app in their native language.

Second, LLMs are a form of accessibility for people like me. Due to an eye injury, I had to stop programming back in 2014. I've taken to puttering, in recent years. But it's still been too much for me to spend all day visually tokenizing source code (which, if you haven't paid attention to what your eyes do while you program, is a large part of what they're up to). Worse yet, I still can't read log files without getting headaches. That needle-in-a-haystack exercise is too painful, no matter how much tail and grep I throw at it.

This is no longer the workflow with an LLM and an agent. Instead, I think about the program, the design, the architecture, the data model, the testing strategy... and ask a robot in the sky to type it up. The minutiae of programming, which would normally keep my time in the text editor limited to weekends, is almost entirely delivered by the LLM. Limiting screen time allowed me to work through an entire month. The kind of work I did in January will be addressed below, under "Problems." But it can't be denied that I was creating software I simply wouldn't have, on my own.

## Ways of Working

Some friends and I held a 4-hour LLM/agent/orchestrator show-and-tell the other Saturday. There appears to be a spectrum across which developers land.

On one end of the spectrum, we have the most cautious developers. The I've-never-touched-an-LLM-and-never will folks fit in here, but so do the people who have taken LLMs for a test drive, didn't like it, and decided they're still best used for conversations or banal minutiae, like puking out a one-off bash or python script. In my experience, these people are writing C, C++, or Rust... or working in some antiquated web framework that cause LLMs a lot of problems, due to lack of documentation and online examples. It matters if they introduce tiny bugs. Their work is careful and deliberate. They've been at it for 20 years. They're using GLM-4.7 or paying $20/mo for Claude Code Pro.

On the other end of the spectrum, we have the YOLO crowd. They're writing TypeScript, they let the LLM write the test suite, their ~/.claude/settings.json is 4 pages long and extremely permissive. brew install? Sure! Whatever you need, Claude. Their work is fast, exploratory, and experimental. The architecture is fragile and the code is sloppy -- intentionally. They're using a pay-as-you-go model and burning tokens worth a mid-level developer salary, per person, every month, on average.

And in the middle are those of us who don't fit in either of these buckets. For instance, I tend to spend a lot of time planning system seams, thinking about the data model, worrying about database schema evolution, API versioning, security without design complexity, and architecture documents that tie it all together. The LLM has no concept of time, the evolution of the system, or the ways the architecture intersects with either of those concepts. That much is still up to a human.

## Problems

I've seen more than one article or study on "AI Fatigue" this past week. In our 4-hour marathon show-and-tell, this was the topic that came up most often amongst folks who were making heavy use of LLMs. I was surprised how many folks were asking each other, "so... how are you feeling with all this?"

As one friend put it, LLMs front-load work we're accustomed to performing at intervals, after a small batch of creative work is done: reviewing, QA, evolutionary design... even refactoring. We're not accustomed to flexing those muscles. Not this often, at least. We wind up playing every role on the team -- from product manager to analyst to iteration manager to engineering manager to tech lead to QA -- in part because we can, in part because we must. It's exhausting.

This is compounded by an effect I like to call The Sweaty Yegge. I mean no disrespect to Steve Yegge, but he seems like an excitable guy and he's definitely too excited about LLMs. Steve gets excited by things. We all do. But if you find yourself engaged in a Sweaty Yegge episode, I'd encourage you to reflect and say to yourself: "don't get too excited, too quickly." There will be time to learn these tools and that time doesn't need to be now. The tools will be completely different in six months.

I'm aware it's difficult to reconcile a calm outlook on the industry at the moment, given the exponential pace of LLM improvements. But the best of what these programs have to offer us will only come when the next AI winter finally comes to cool things off.

Which brings us to the last bit of LLM psychology: attachment and addiction. These two problematic states of mind are in opposition to one another.

When I say "attachment", I am referring to an attachment to the act of programming itself. This is changing, and, for anyone who has tried these tools in the past few months, there is little doubt that it is changing. But for many programmers, the tiny joys are the ones that give hacking all its meaning. The perfect abstraction feels like a perfectly-salted meal. A concise unit test is a flawless wooden inlay. A solid concurrency model is a series of brushstrokes on a painting where the painter wouldn't change a thing. LLMs take these little joys away. It isn't the end of programming. But it is the end of an era. That makes some people sad.

When I say "addiction", I am referring to an addiction to getting things done. Especially if you already know what you're doing, LLMs can make you feel superhuman. Like steroids or vyvanse, it's a performance-enhancer. And like steroids or vyvanse, you can get hooked on the performance it enables. One friend, very much on the "YOLO as many tokens as the company can afford" end of the spectrum, said she had to cut herself off because she found herself prompting with her laptop open on the backs of motorcycles driving through the streets of Bangalore.

The upcoming AI winter won't solve either of these problems. The changes which have come to the profession of programming are permanent changes. Expressing your distaste for LLMs or your sadness for the advent of the transformer will be approximately as effective as railing against cars or capitalism. There will be programming "purists" for many years to come... but they will need to learn to deal with their sadness and anger, or be consumed by it. Similarly, the shimmer of GTD will consume those who don't learn to ration it out, to pace themselves, and to give themselves time to think.

## Meta-Problems: Open Gates

Beyond the copyright violations and the dangerous new psychological landscape, there's a higher-level problem with the current distribution models for LLMs in 2026. There's an opportunity for lock-in that chills me to the bone.

While there are almost no truly "open" models yet, as we tend to think of open source and open data, the difference between the current crop of "open models" and fully proprietary models is striking. The proprietary models are given more food with every prompt and, when a model consumes this way, it feeds only itself. A virtuous circle for shareholders. A downward spiral for customers. This could lead to an entirely new era of data gatekeeping and walled gardens.

## The Future

Do I think we should use LLMs at Pariyatti, or any other nonprofit I work with? I'm not sure, to be honest. The higher-level ethical concerns of these organizations aren't my jurisdiction. But I do hope this essay provides some food for thought and helps those in management positions consider the topic of LLMs from multiple angles.

Do I think I should use LLMs at work? I need to give further consideration to the accessibility afforded by these tools. Just because I have a disability doesn't make LLMs the right tool choice. But, in all likelihood, this choice will not be mine to make.
