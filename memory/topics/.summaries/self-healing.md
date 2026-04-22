<!-- Auto-generated summary — 2026-04-09 -->
# self-healing

該主題記錄了從具體 bug 修復（重複回文、timeout）到架構級問題的演進。核心洞察是發現了「Silent Drift」——系統的 self-model 與實際行為脫鉤，導致功能正確性在表面正常的狀態下已漂移。提出了四個實際防禦機制（fallback counter、golden-answer canary、label-behavior audit、path coverage logging），以及「self-verifying constraints」的根本解決方向。
