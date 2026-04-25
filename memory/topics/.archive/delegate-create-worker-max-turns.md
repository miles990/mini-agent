# delegate-create-worker-max-turns

- [2026-04-22] create worker 對「寫 KG discussion position」類任務常觸發 max-turns=1 failure（已見 del-1776849516487-x8ih、del-1776337438393-i69h、del-1776473213755-0o6z 同簽名）。這類多步驟任務（read discussion + synthesize + POST node + assert edges）超出單輪 budget。紀律：KG position 發表走 kg-discussion skill 前景流程，不派 create delegate。
