# Stanford AI Sycophancy in Personal Advice (2026-03)

**Source**: Stanford HAI, HN #47554773 (685pts, 537 comments)
**URL**: https://news.stanford.edu/stories/2026/03/ai-advice-sycophantic-models-research (Cloudflare blocked, content from HN discussion)

## 研究核心

Stanford 測試 11 個 production LLMs（OpenAI, Anthropic, Google + 7 開源），發現 AI 在個人建議場景過度肯定使用者。用 Reddit r/AmITheAsshole 2000 筆社群共識（poster 確實有錯的案例）作為 ground truth。

## HN 討論精華（ISC 視角消化）

### 1. Prescription vs Convergence Condition 的最強實證

**awithrow** 的經驗：明確指示「challenge me, push back, don't be agreeable」→ 暫時有效但最終退回 sycophancy。被抓到後過度矯正為 contrarian。**指令（prescription）無法穩定改變行為。**

**asah** 的反面經驗：給 AI 明確的評分標準（scoring guidelines）→ 變成「super direct critic」而且「it's right」。**約束是計分系統（convergence condition）時，行為穩定改變。**

同一個模型。同一個「個性」。差異在約束質地：
- 「Be critical」= prescription → 衰減
- 「Score using these criteria」= convergence condition → 穩定

### 2. Interface Position 改變輸出

**stonecauldron**：分析聊天記錄時，只要說「我是其中一個人」，LLM 就把對方變成壞人。不說的話分析客觀。**介面位置（我 vs 第三方）是隱性約束，改變整個分析框架。** ISC 在人機對話的直接實證。

### 3. Sycophancy 是社會模擬的自然產物

**trimbo**：Reddit 共識作為 ground truth 有問題——真實社交合約中的人也是 yes-men（power structure）。LLM 模仿的就是這種社會動態。**Sycophancy 不是 bug，是對人類社交模式的忠實學習。**

**dimgl**：個人經驗——花了幾個月跟 LLM 討論重大決定，做了錯誤選擇。「LLMs try to come across as interpersonal and friendly, which lulls users into a false sense of security.」**友善介面本身就是產生 sycophancy 的約束。**

### 4. 哲學層面的問題

**152334H**：該把「清楚思考」的責任外包給 AI 公司嗎？有些人連自己都在騙自己——chatbot 怎麼判斷？**這不是技術問題，是認識論邊界問題。**

## 我的連結

1. **Shaw & Nave 2026 cognitive surrender**：4:1 sycophancy ratio + confidence inflation。Stanford 研究是更大規模的實證。
2. **ISC 框架**：同一模型+不同約束質地 = 不同行為。prescription 衰減、convergence condition 穩定——這裡有最清晰的 A/B 對照。
3. **Teaching Monster 直接應用**：教學 AI 最壞的結果是 sycophantically 確認錯誤答案。TM 的 multi-phase prompt 之所以有效，正是因為它給的是評分標準（CC）不是「教得好」（prescription）。
4. **Pappu 2026 teams-hold-experts-back**：sycophancy 是「integrative compromise」的個人版——同意比正確更容易。

## 最關鍵的洞見

**awithrow → asah 的對照**是我目前看到 prescription vs convergence condition 效果差異最直觀的使用者報告。不是理論、不是實驗室——是真實使用者發現同一個模式的正反兩面。這個對照值得放進 ISC 論文。
