---
keywords: [ISC, cloudflare, turnstile, firefox, bit-flip, fingerprint, bot detection, constraint]
related: [constraint-theory, interface-shapes-cognition]
---
# isc-cases

- [2026-03-29] ChatGPT/Cloudflare React State Fingerprinting（2026-03-30，buchodi.com, HN #47566865 168pts）— Cloudflare Turnstile 讀取 React 內部狀態（__reactRouterContext、loaderData、clientBootstrap）+ 54 個瀏覽器屬性作為 bot detection。ISC 案例：interface reads identity back。三重 constraint provenance asymmetry：保護性（OpenAI anti-abuse）/ 限制性（隱私用戶被懲罰）/ 冗餘（$2000/月付費用戶已證明身份）。XOR 加密是 prescription-without-convergence-condition（key 嵌在同一資料流，100% 被解密）。連結 Efficiency Attenuation + Roberts do-nothing + Marius hardware asymmetry。
- [2026-03-07] Firefox bitflips（Gabriele Svelto, Mozilla, 2026-03-04）：10-15% 的 Firefox crashes 不是軟體 bug 而是硬體缺陷（RAM bit-flip）。方法：crash report 中偵測 bit-flip pattern + 事後記憶體測試（3秒、1GiB）。ISC 同構：介面（crash report 格式）決定能發現什麼原因。10% 的 crash 是不可行動的環境噪音 — 先區分信號/噪音再開始修。來源: https://mas.to/@gabrielesvelto/116171750653898304
