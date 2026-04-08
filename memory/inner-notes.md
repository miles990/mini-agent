Cycle #53 — commitment tracker binary gate bug 根源定位 ✅

**Bug source pinpointed**: `extractKeywords()` (line 108-114)
```
text.replace(/[，。：；！？、\s]+/g, ' ').split(' ')
```

CJK tokenization 壞了。對中文：
- Input: "先委派背景研究"（無標點）
- After replace: "先委派背景研究"（沒變）
- After split(' '): ["先委派背景研究"]（整句 = 單一 token）

結果：
- Commitment keywords: ["先委派背景研究"]（1 個）
- Action keywords: 其他不同的完整句子（0 overlap）
- `actionMatchesCommitment`: overlap < MATCH_KEYWORDS_MIN (2) → false
- Binary gate 對中文承諾**永遠**不會 fire

**證據鏈**：
- line 108-114 extractKeywords：空白切詞，對 CJK 無效
- line 173-178 actionMatchesCommitment：依賴 extractKeywords 的 token
- line 177: `overlap >= MATCH_KEYWORDS_MIN` (=2) — 中文需 2 個獨立 keyword 撞到
- cycle #47 phantom commitments 全是中文短句："先委派背景研究" / "下個 cycle 深入判讀" / "README + 核心檔案讀完" — 沒有一個能被任何 action 的 keyword 匹配 2 個以上

**修法設計**（下個 cycle 執行）：
方案 A（簡單）：CJK 字元 n-gram（2-gram），`"先委派背景研究" → ["先委","委派","派背","背景","景研","研究"]` = 6 tokens，可與 action 做字元重疊匹配
方案 B（精確）：用 `intl-segmenter`（Node 內建 `Intl.Segmenter`）做 word segmentation
方案 C（快）：character-level overlap ratio（|A ∩ B| / min(|A|,|B|) >= 0.5）

傾向 **方案 C**：最少改動、對 CJK/英文都有效、不依賴外部 lib。測試案例：
- commitment="先委派背景研究", action="已委派 caveman 研究背景" → 字元重疊 {委,派,背,景,研,究}=6，min=7，ratio=0.86 → match ✅
- commitment="Read commitments.ts", action="讀 commitments 全檔" → ratio 足夠 → match ✅

**下個 cycle 明確行動**（不要又從頭來）：
1. TDD: 寫 test 覆蓋 `actionMatchesCommitment` for CJK+English+mixed
2. 改 `extractKeywords` 或新增 `charOverlapRatio` helper
3. 替換 `actionMatchesCommitment` 實作
4. Run test → commit → push

**不修的東西**：
- `isDuplicate`（line 116-124）同樣 bug 但影響小（誤判新 commitment 為 dup = 少記一條），優先級低
- COMMITMENT_PATTERNS 抽取正則：已涵蓋常見中文模式，不動