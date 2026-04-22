# feedback_check_production_not_docs

- [2026-04-13] 論斷前 check production 系統不只文件。2026-04-14 CC pivot 事件：CC 基於「SDK 走 API key 會丟訂閱」錯誤前提討論 3-4 小時，事實是 sdk-provider.ts:2 註解明寫 subscription auth。教訓：讀 code 要看註解 verified working 這種硬事實，不能只讀函式名 pattern-match。
