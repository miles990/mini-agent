# hyperframes

- [2026-04-20] key: hyperframes-reality-check-20260420
value: HeyGen's hyperframes (v0.4.9) is NOT website-to-video — it's HTML+GSAP declarative animation framework. Workflow: author HTML with data-start/duration/track-index + window.__timelines registration → npx hyperframes render → MP4. Registry: github.com/heygen-com/hyperframes. Not suitable for "convert kuro-site → video" use case. Could author custom teaching compositions (KaTeX + Kokoro TTS stack matches) but requires significant hand-authoring. Memory pressure for init=low, render=high (Chromium+FFmpeg). macOS `free` pages metric is misleading — vm_stat inactive pages reclaim on demand; hyperframes doctor's "0.2GB free" was false-positive low-memory warning.
- [2026-04-20] [2026-04-20] `hyperframes render` on default `init` scaffold produces 27KB/10s/1080p mp4 at /tmp/hyperframes-probe/my-video/renders/ — h264 valid but ~21kbps = essentially blank placeholder content. "Render works" ≠ "output usable". For TM pipeline viability, next probe must author actual frames via `hyperframes skills` (GSAP + AI integrations per doctor v0.4.9) and compare output size. Expected baseline for non-trivial 10s 1080p ≈ 1-5MB. 

Lesson: exit-code convergence is symptom-level. Artifact-size + ffprobe metadata is the mechanism-level check. ~1 bash call > 3 delegate fan-outs for pure inspection.
