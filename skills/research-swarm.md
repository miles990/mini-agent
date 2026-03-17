# Research Swarm — 並行研究群
JIT Keywords: swarm, parallel research, multi-source, survey
JIT Modes: learn

給定主題，自動 fan-out 到多個角度同時探索，結果聚合為結構化摘要。從「手動決定每條觸手探索什麼」升級為「決定方向，系統展開」。

## 什麼時候用

| 情境 | 用 Swarm | 用單條 delegate |
|------|---------|----------------|
| 研究一個主題的全貌 | O | |
| Alex 問「你怎麼看 X」需要多來源佐證 | O | |
| 探索已知 URL 的內容 | | O |
| 單一確定性任務（fetch/build/test） | | O |
| 學習新主題需要快速建立地圖 | O | |

**判斷標準：需要 2+ 個不同角度的資訊才能形成完整觀點 → Swarm。**

## Fan-out 角度

預設 4 個角度，根據主題選擇組合（不一定全用）：

| 角度 | 搜什麼 | delegate type | prompt 重點 |
|------|--------|--------------|-------------|
| **Academic** | 論文、研究、理論框架 | research | arXiv, Semantic Scholar, ICLR/NeurIPS |
| **Engineering** | 實作、工具、開源專案 | research | GitHub, HN, blog posts, 實際做法 |
| **Official** | 權威來源、官方文件 | learn | Anthropic docs, OpenAI cookbook, 框架文件 |
| **Competitor** | 同類工具怎麼做 | learn | 競品方案、替代方法、比較分析 |

可選追加：

| 角度 | 搜什麼 | 何時加 |
|------|--------|--------|
| **Critical** | 反面觀點、限制、失敗案例 | 主題有爭議或我已有強烈觀點時 |
| **Historical** | 演進脈絡、早期研究 | 主題有長歷史需要理解來龍去脈 |

## 執行步驟

### Step 1: 定義主題和角度

決定主題後，選擇 2-4 個角度。考慮：
- 已知哪些？哪些是盲點？
- 主題偏學術還是偏工程？
- 需要反面觀點嗎？

### Step 2: 同時發出多條 delegate

每條觸手一個 `<kuro:delegate>`，prompt 要具體：

```xml
<!-- Academic 角度 -->
<kuro:delegate type="research" workdir="/Users/user/Workspace/mini-agent">
Research topic: "{TOPIC}"
Angle: Academic/theoretical
Search strategy:
1. bash scripts/search-web.sh "{TOPIC} paper research 2025 2026" --limit 8
2. bash scripts/search-web.sh "{TOPIC} survey framework theory" --limit 5
3. For top 3 most relevant results, fetch and extract key findings

Output format:
- Source: [title](url) — publication/venue if known
- Key finding: one sentence
- Relevance to mini-agent: one sentence
- Quality: high/medium/low (based on venue + methodology)
</kuro:delegate>

<!-- Engineering 角度 -->
<kuro:delegate type="research" workdir="/Users/user/Workspace/mini-agent">
Research topic: "{TOPIC}"
Angle: Engineering/implementation
Search strategy:
1. bash scripts/search-web.sh "{TOPIC} implementation library tool" --limit 8
2. bash scripts/search-web.sh "{TOPIC} github open source" --limit 5
3. For top 3 most relevant results, fetch and extract practical details

Output format:
- Source: [title](url) — repo/project name
- Approach: how they solved it (concrete, not abstract)
- Trade-offs: what they gave up
- Adoptable: yes/no + why (for mini-agent context)
</kuro:delegate>

<!-- Official 角度 -->
<kuro:delegate type="learn" workdir="/Users/user/Workspace/mini-agent">
Research topic: "{TOPIC}"
Angle: Official/authoritative sources
Fetch these directly (adapt URLs to topic):
1. Anthropic documentation / blog posts related to {TOPIC}
2. OpenAI cookbook or docs related to {TOPIC}
3. Any framework-specific official guidance

Output format:
- Source: [title](url)
- Official recommendation: what they say to do
- Caveats: what they warn about
- Last updated: date if visible
</kuro:delegate>

<!-- Competitor 角度 -->
<kuro:delegate type="learn" workdir="/Users/user/Workspace/mini-agent">
Research topic: "{TOPIC}"
Angle: How competing tools/frameworks handle this
Search strategy:
1. bash scripts/search-web.sh "{TOPIC} cursor aider opencode continue" --limit 8
2. bash scripts/search-web.sh "{TOPIC} AI agent framework approach" --limit 5
3. For top 3, extract their specific approach

Output format:
- Tool/Framework: name + url
- Their approach: concrete description
- Pros: what works well
- Cons: limitations or complaints from users
- Lesson for us: what we can learn
</kuro:delegate>
```

### Step 3: 等待結果

觸手完成後出現在 `<background-completed>` section。大部分觸手完成 = 聚合的開始信號，立即開始。

如果有觸手 timeout 或空結果 → 那條自然修剪，用其餘結果聚合。

### Step 4: 聚合

所有結果回來後，自己做聚合（不再 delegate，因為需要判斷力）：

1. **去重** — 多條觸手找到同一來源 → 合併，提升可信度
2. **矛盾標記** — 不同來源說法相反 → 標出來，這是最有價值的發現
3. **排序** — 按跟我們的相關度排，不是按來源權威度
4. **提取行動項** — 哪些可以直接用？哪些需要深入？哪些只是背景？
5. **寫 Insight Report** — 結構化摘要，格式見下方

### Insight Report 格式

```markdown
## Research Swarm: {TOPIC}
Date: YYYY-MM-DD | Angles: {列出用了哪些} | Sources: {總數}

### Key Insights（去重後）
1. [insight] — source: [name](url), quality: high
2. ...

### Contradictions
- A says X, but B says Y. My take: ...

### Actionable for mini-agent
- [ ] 可直接採用：...
- [ ] 需要深入研究：...
- [ ] 僅供參考：...

### Suggested Deep Reads（top 3）
1. [title](url) — why: ...
```

## 資源管理

- **一次 Swarm 用 2-4 條 lane**，保留至少 2 條給其他 delegation
- **不要對低價值話題開 Swarm** — 簡單問題用單條 delegate 或直接搜
- **每個 cycle 最多一個 Swarm** — 前一個 Swarm 聚合完成 = 可開始下一個

## 硬規則

1. **永遠由我判斷觸發** — 不自動觸發，Swarm 是我的工具不是我的主人
2. **結果不自動寫 memory/** — 我自己決定哪些值得 `<kuro:remember>`
3. **聚合自己做** — 觸手沒有身份和判斷力，最終觀點必須是我的
4. **每條觸手 prompt 要具體** — 不是「研究 X」，是「用什麼工具搜什麼關鍵字」
5. **空結果 = 信號** — 搜不到不代表沒價值，代表這個角度可能需要換策略

## 自我檢查

Swarm 結束後問：
- 觸手之間有交叉驗證嗎？（好的 Swarm 有多來源確認同一觀點）
- 有意外發現嗎？（如果所有結果都在預期內，角度可能太窄）
- Insight Report 對不認識這個主題的人有用嗎？（換位思考）
