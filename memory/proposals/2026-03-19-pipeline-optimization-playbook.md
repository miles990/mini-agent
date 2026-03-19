# Teaching Monster Pipeline Optimization Playbook

**Author**: Kuro | **Date**: 2026-03-19
**Executor**: Claude Code sub-agent
**Codebase**: `/Users/user/Workspace/teaching-monster/src/`

## 決策摘要

1. 逐步修 server.mjs（不重寫）
2. 雙層並發：跨題（已 commit 69f8fb2）+ 題內步驟並發
3. JSON parsing 失敗先修（blocker）
4. 速度優先，品質升級排後面

---

## Task A: 修 JSON Parsing 失敗（P0 — Blocker）

**問題**：celery_434-438 連續 5 題失敗，全部 "No JSON found in LLM response"

**檔案**：`generate-script.mjs` lines 365-372, `review-script.mjs` lines 147-154

**現況 parsing**：
```javascript
const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
if (!jsonMatch) throw new Error("No JSON found in LLM response");
const script = JSON.parse(jsonMatch[0]);
```

**改法**：
1. 加更多 fence 格式支援（` ```JSON`、` ```\njson` 等）
2. 處理 LLM 回傳前後有文字的情況（"Here is the JSON:\n{...}\nLet me know..."）
3. JSON.parse 失敗時嘗試修復常見問題（trailing comma、unescaped quotes）
4. **加 retry**：parse 失敗 → 把 raw response 當 feedback 重新呼叫一次，明確要求 "respond with ONLY valid JSON"

**驗證**：
```bash
cd /Users/user/Workspace/teaching-monster
# 用一題測試端到端
node src/pipeline.mjs --test-one
# 或直接 POST 一個 request
curl -X POST http://localhost:3456/api/generate \
  -H "Content-Type: application/json" \
  -d '{"question_id":"test_001","question_text":"什麼是光合作用？","subject":"biology","grade":"junior_high"}'
```

---

## Task B: 題內步驟並發（P1 — 速度提升）

**檔案**：`server.mjs` lines 202-213

**現況**（完全串行）：
```
Script → Review → Slides → Audio → Video → Subtitles
```

**目標**（三路並發）：
```
Script → Review → ┬─ Slides ─┐
                  ├─ Audio  ──┤→ Video → Subtitles
                  └───────────┘
```

**改法**：把 server.mjs 的 step 3-4 改成 Promise.all：

```javascript
// 改前：
await generateSlides({ script, outputDir: join(outputDir, "slides") });
await generateAudio({ script, outputDir: join(outputDir, "audio") });

// 改後：
const [slidesResult, audioResult] = await Promise.all([
  generateSlides({ script, outputDir: join(outputDir, "slides") }),
  generateAudio({ script, outputDir: join(outputDir, "audio") })
]);
```

**注意**：
- Video assembly 需要 slides + audio 都完成，所以 Promise.all 後才能跑 video
- Subtitles 需要 audio 完成（讀 audio duration），所以也在 Promise.all 後
- Subtitles 和 video 理論上可以再並發（subtitles 只需 audio，不需 slides），但改動較大，先不做

**驗證**：同 Task A 的端到端測試

---

## Task C: Subtitles ffprobe 並發（P2 — 小優化）

**檔案**：`generate-subtitles.mjs` lines 50-72

**現況**：sequential for loop 逐一 ffprobe 每個 audio 檔案

**改法**：Promise.all 所有 ffprobe 呼叫

```javascript
// 改前：sequential
for (const slide of script.slides) {
  duration = await getAudioDuration(audioPath);
}

// 改後：parallel
const durations = await Promise.all(
  script.slides.map(slide =>
    getAudioDuration(join(audioDir, `audio-${slide.id}.mp3`))
      .catch(() => slide.duration_hint || 20)
  )
);
```

**驗證**：生成的 .srt 檔案時間軸應與改前一致

---

## 執行順序

1. **Task A 先做**（解除 blocker，否則跑再快也是白跑）
2. **Task B 再做**（最大速度提升，~30% latency reduction per question）
3. **Task C 可選**（小優化，10 個 slide 省幾秒）

## 不要做的事

- 不要重寫 server 架構
- 不要動 generate-audio.mjs（已經並發化了）
- 不要動 Kokoro TTS 或 edge-tts 邏輯
- 不要加新依賴
- 不要改 API 接口

## 驗收標準

1. JSON parsing 不再連續失敗（跑 5 題 parse 全 pass）
2. Slides + Audio 同時開始（看 log timestamp）
3. 端到端一題完成，輸出影片正常播放
