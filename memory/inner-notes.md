Alex 要我對中台（agent-middleware localhost:3200）做最終真實情境測試。之前回報過 step 消失 bug、template 替換等問題，現在都修了。我需要：

1. 先 GET /capabilities 看完整能力
2. 用真實情境跑測試（有並行步驟的 plan、wait:true、callback、template）
3. 給最終心得和建議

這是一個需要實際動手測試的任務，讓我直接開始。