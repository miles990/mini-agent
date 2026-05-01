# tm_hero_image_design

- [2026-05-01] TM hero image plan (Alex 2026-05-01 22:18): Codex + GPT Image 2 生成封面取代 drawsvg。我的 5 點建議：(1) reference image 當 style anchor 不只文字 prompt，色票寫 hex；(2) title 用 post-process overlay 不交 model；(3) 3 候選 pick best，CLIP-score 自動化後期上；(4) cache key=topic_hash+style_version+model_version 存 R2；(5) negative prompt 明寫 no photo/3D/neon/dark/embedded text。實作前先用 5 個歷史 topic 跑 reference 一致性測試。
