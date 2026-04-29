<!-- Auto-generated summary — 2026-04-29 -->
# 2026-04-29-tag-prototype-verdict

原型 tag 系統測試失敗（21.4% agreement 遠低於 50% 門檻），原因是 regex 結構性缺陷。決策是用 LLM tagger 取代上游 regex（降級為 fallback），透過 sidecar 解耦架構來最小化風險並保留可逆性。下一週期分三步驟實施，並設定 falsifier 來驗證生產品質。
