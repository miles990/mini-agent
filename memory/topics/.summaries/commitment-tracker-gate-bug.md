<!-- Auto-generated summary — 2026-04-22 -->
# commitment-tracker-gate-bug

commitment-tracker 系統有兩個結構性 bug：（1）memory-index.ts 的二元 gate 邏輯導致自我實現的承諾永不解決，（2）commitments.ts 對中文的 tokenize 方法無法正確匹配關鍵詞。兩個 bug 都已修復（d69a4736 & char-overlap ratio），但核心教訓是重複出現的模式（3+次）表示結構性問題需要修復或清空狀態，以及 rumination-digest 必須標記 RESOLVED 狀態防止過時報告誤導未來週期。
