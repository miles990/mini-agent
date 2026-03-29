# JSON Parsing Edge Cases — extractJSON

File: /Users/user/Workspace/teaching-monster/src/generate-script.mjs

## Function Location
Lines 34–112

## Bug 1: Greedy Regex Fallback Can Swallow Too Much (line 58)

```js
const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
```

This regex is greedy. If the LLM response contains multiple JSON objects (e.g., a
reasoning block followed by the actual output), it will match from the FIRST `{` to
the LAST `}`, potentially including non-JSON prose inside. The knownKeyPatterns priority
check (lines 41-54) partially mitigates this, but when none of the six known keys match,
the greedy fallback fires and can produce an over-large raw string that fails all
five parse attempts — returning null silently.

Concretely: if a step1 plan starts with `{"thinking":"...{example}..."}` followed by the
real `{"sections":[...]}`, the greedy match returns the entire span including both
objects. Since that is invalid JSON, attempts 2-5 run but jsonrepair may produce the
wrong object.

## Bug 2: Attempt 3 Lookbehind Regex Is Node.js-Only (line 77)

```js
repaired = repaired.replace(/(?<=[\[,]\s*)"([^":]*)"\s*\(([^)]*?)\)/g, '"$1 ($2)"');
```

Lookbehind assertions (`(?<=...)`) are not supported in older V8 / certain JS runtimes.
This is not an immediate issue on modern Node.js but creates a maintenance risk. More
importantly, the regex only runs after attempts 1 and 2 fail, meaning valid JSON never
reaches it — the risk is contained but the regex's correctness is untestable in isolation.

## Bug 3: Attempt 5 Resets start=-1 on Parse Failure but Continues Loop (lines 98-103)

```js
if (depth === 0 && start !== -1) {
  try {
    return JSON.parse(repaired.slice(start, i + 1));
  } catch {
    start = -1;  // reset and continue searching for next balanced pair
  }
}
```

When the first balanced `{...}` fails to parse, `start` is reset to -1 but the loop
continues. The next `{` encountered restarts depth tracking from `depth=0`, meaning
only depth++ happens — depth never goes negative. This correctly skips the outer shell
and tries the next top-level brace group. However, if the failing outer object contains
nested `{...}` blocks, depth re-enters the inner object before any new `{` at depth 0
is found. In practice, attempt 5 only helps if there are multiple sibling top-level
objects, which is exactly the greedy-regex-over-capture scenario from Bug 1. The logic
is correct for that case.

## Bug 4: extractJSON Returns null Silently Without Logging (line 107)

When all five attempts fail, the function returns null. The caller at line 2362
(`let plan = extractJSON(step1Text)`) checks for null and throws — good. But at line
2582 (`let sectionData = extractJSON(text)`) in the parallel section generation loop,
a null result falls through to the prose fallback only IF the text contains
`---SLIDE---` or `[SHOW:]` markers. If the LLM returned something unparseable that
ALSO lacks those markers, `sectionData` remains null and the error at line 2592 fires,
failing the section (which is then retried — acceptable). But there is no log of what
the actual LLM response contained at that point, making debugging hard. The raw text is
saved to `_step2_section{N}_raw.txt` (line 2578) which helps, but only if `outputDir`
is provided. With no `outputDir`, parse failures are completely invisible.

## Bug 5: knownKeyPatterns Does Not Include "title" at Top Level for Section JSON (line 41)

The six known key patterns include `"title"` but the section writer (Step 2a) returns
JSON with key `"slides"` at top level. The `"slides"` pattern is included. However,
if the LLM wraps the section JSON with a different outer key (e.g., `{"section":{"slides":
[...]}}`) none of the patterns match and the greedy fallback fires, which would correctly
find the outer object — but then `sectionData.slides` would be undefined, triggering the
prose fallback.

