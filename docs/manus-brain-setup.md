# 從零開始：mini-agent 整合 Telegram 與 Manus AI 大腦教學指南

這份教學指南將手把手帶領您，如何透過 Telegram API (GramJS) 讓您的 mini-agent 專案與 @manus_ai_agent_bot 進行溝通，將 Manus AI 作為您的 LLM 大腦使用。我們將涵蓋從 Telegram API 申請到程式碼整合的每一個細節。

## 1. 前置準備：您需要什麼？

在開始之前，請確保您已具備以下條件：

*   **Telegram 帳號**：一個活躍的 Telegram 帳號，用於申請 API 憑證和登入。
*   **手機號碼**：與您的 Telegram 帳號綁定的手機號碼，用於接收登入驗證碼。
*   **Node.js 與 npm/yarn**：您的開發環境需要安裝 Node.js (建議 LTS 版本) 和套件管理器 (npm 或 yarn)。
*   **基本的 TypeScript/JavaScript 知識**：本指南將提供完整的程式碼範例，但具備基本的程式設計知識將有助於您理解和客製化。

## 2. 步驟一：申請 Telegram API ID 和 API Hash

這是讓您的應用程式能夠透過 Telegram API 存取您帳號的關鍵憑證。請按照以下步驟操作：

1.  **前往 Telegram API 開發者網站**：
    開啟您的網頁瀏覽器，前往 [https://my.telegram.org](https://my.telegram.org)。

2.  **登入您的 Telegram 帳號**：
    輸入您的手機號碼，然後點擊「Next」。Telegram 會向您的手機應用程式發送一個登入驗證碼。在網頁上輸入該驗證碼並完成登入。

3.  **進入 API 開發工具頁面**：
    登入成功後，您會看到一個頁面。請點擊「API development tools」連結。

4.  **填寫應用程式資訊**：
    在「Create new application」頁面，您需要填寫以下資訊：
    *   **App title (應用程式標題)**：填寫一個描述您應用程式的名稱，例如 `MiniAgentTelegram`。
    *   **Short name (簡稱)**：填寫一個簡短的名稱，例如 `miniagent`。這將用於內部識別。
    *   **Package name (套件名稱)**：對於非 Android 應用程式，您可以填寫 `org.miniagent.telegram` 或類似的唯一識別符。
    *   **App version (應用程式版本)**：填寫 `1.0` 或您目前的版本號。
    *   **Short description (簡短描述)**：簡要描述您的應用程式用途，例如 `Telegram client for Mini-Agent project`。
    *   **URL (網址)**：可選填，如果您的應用程式有網站，可以填寫。如果沒有，可以留空。

    填寫完畢後，點擊「Create application」。

5.  **取得您的 API ID 和 API Hash**：
    成功建立應用程式後，您將會看到一個頁面，其中包含您的 `App api_id` 和 `App api_hash`。**請務必將這兩組資訊妥善保存，它們是您應用程式存取 Telegram API 的重要憑證，切勿洩露給他人。**

    *   `api_id` 是一個數字。
    *   `api_hash` 是一個由字母和數字組成的字串。

    （此處應有截圖說明每一步，但作為 AI 助手無法直接提供截圖。請用戶自行參考上述步驟進行操作。）

## 3. 步驟二：（可選）用 BotFather 建立自己的 Bot

如果您希望 mini-agent 能夠接收來自其他 Telegram 用戶的指令，或者您想將 Manus AI 的回應透過一個專屬的 Bot 轉發，那麼建立一個自己的 Bot 會很有幫助。這個 Bot 將作為 mini-agent 與用戶互動的介面。

1.  **在 Telegram 中搜尋 BotFather**：
    開啟您的 Telegram 應用程式，在搜尋欄中輸入 `@BotFather` 並選擇它。BotFather 是 Telegram 官方用來管理 Bot 的 Bot。

2.  **開始與 BotFather 對話**：
    點擊「Start」按鈕，或輸入 `/start` 命令。

3.  **建立新 Bot**：
    輸入命令 `/newbot`。BotFather 會引導您完成 Bot 的建立過程：
    *   **選擇 Bot 名稱**：輸入一個用戶友好的名稱，例如 `MiniAgentCommander`。
    *   **選擇 Bot 用戶名**：輸入一個以 `bot` 結尾的唯一用戶名，例如 `MiniAgentCommanderBot`。這個用戶名將是其他用戶找到您 Bot 的方式。

4.  **取得 Bot Token**：
    成功建立 Bot 後，BotFather 會提供一個 `HTTP API Token`。**這是一個非常重要的憑證，請務必妥善保存，切勿洩露。**您的 mini-agent 將使用這個 Token 來控制您的 Bot。

    （此處應有截圖說明每一步，但作為 AI 助手無法直接提供截圖。請用戶自行參考上述步驟進行操作。）

## 4. 步驟三：安裝 GramJS (Node.js MTProto 庫)

GramJS 是一個強大的 Node.js 庫，它實現了 Telegram 的 MTProto 協議，讓您可以像官方客戶端一樣與 Telegram 進行互動。這與使用 Bot API 不同，GramJS 允許您以用戶身份登入，這對於與 @manus_ai_agent_bot 溝通至關重要。

1.  **建立專案目錄並初始化**：
    在您的開發環境中，建立一個新的資料夾作為您的專案目錄，並初始化 Node.js 專案：
    ```bash
    mkdir mini-agent-telegram
    cd mini-agent-telegram
    npm init -y
    ```

2.  **安裝 GramJS**：
    使用 npm 或 yarn 安裝 `telegram` 套件：
    ```bash
    npm install telegram
    # 或者
    yarn add telegram
    ```

3.  **安裝 TypeScript (如果使用)**：
    如果您打算使用 TypeScript (強烈建議)，請安裝 TypeScript 及其相關型別定義：
    ```bash
    npm install -D typescript @types/node
    # 或者
    yarn add -D typescript @types/node
    ```
    然後建立 `tsconfig.json` 檔案：
    ```bash
    npx tsc --init
    ```
    在 `tsconfig.json` 中，您可能需要調整 `target` (例如 `es2020`) 和 `outDir` (例如 `./dist`)。

現在，您已經完成了前置準備和 Telegram API 憑證的獲取，並安裝了 GramJS。接下來我們將進入程式碼實作部分。

## 5. 步驟四：用 GramJS 登入您的 Telegram 帳號

GramJS 允許您以用戶身份登入 Telegram，這意味著您的程式碼將模擬一個普通的 Telegram 用戶。為了避免每次執行程式都重複登入，我們需要保存會話 (session) 資訊。

### 5.1 程式碼範例：登入與會話保存

建立一個 `login.ts` (或 `login.js`) 檔案，並加入以下程式碼：

```typescript
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import 'dotenv/config'; // 用於載入 .env 檔案中的環境變數

const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
const apiHash = process.env.TELEGRAM_API_HASH || '';
const stringSession = new StringSession(process.env.TELEGRAM_SESSION || ''); // 從環境變數讀取或初始化空會話

async function main() {
  console.log('正在嘗試登入 Telegram...');

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => {
      // 第一次登入時，如果沒有會話，會要求輸入手機號碼
      console.log('請輸入您的手機號碼 (含國碼，例如 +886912345678):');
      return new Promise(resolve => process.stdin.once('data', data => resolve(data.toString().trim())));
    },
    password: async () => {
      // 如果您設定了兩步驟驗證，會要求輸入密碼
      console.log('請輸入您的兩步驟驗證密碼 (如果沒有請留空):');
      return new Promise(resolve => process.stdin.once('data', data => resolve(data.toString().trim())));
    },
    phoneCode: async () => {
      // 第一次登入或會話失效時，會要求輸入驗證碼
      console.log('請輸入您 Telegram 應用程式收到的驗證碼:');
      return new Promise(resolve => process.stdin.once('data', data => resolve(data.toString().trim())));
    },
    onError: (err) => console.error('登入錯誤:', err),
  });

  console.log('登入成功！');
  console.log('您的會話字串 (請妥善保存到 .env 檔案中):', client.session.save());

  // 您可以在這裡執行其他操作，例如發送訊息
  // await client.sendMessage('me', { message: 'Hello from GramJS!' });

  await client.disconnect();
  console.log('已斷開連線。');
}

main().catch(console.error);
```

### 5.2 環境變數設定 (`.env`)

為了安全地管理您的 `api_id`、`api_hash` 和會話字串，我們將使用 `dotenv` 套件。在專案根目錄建立一個 `.env` 檔案，內容如下：

```dotenv
TELEGRAM_API_ID=您的_API_ID
TELEGRAM_API_HASH=您的_API_HASH
TELEGRAM_SESSION=
```

**重要提示**：
*   將 `您的_API_ID` 和 `您的_API_HASH` 替換為您在步驟一中獲得的實際值。
*   `TELEGRAM_SESSION` 一開始留空。第一次成功執行 `login.ts` 後，程式會輸出一個很長的會話字串，請將其複製並貼到 `TELEGRAM_SESSION=` 後面。之後再次執行程式時，GramJS 就會直接使用這個會話字串登入，無需重複輸入手機號碼和驗證碼。

### 5.3 執行登入程式

首先，確保您已安裝 `dotenv`：

```bash
npm install dotenv
# 或者
yarn add dotenv
```

然後，編譯並執行 `login.ts`：

```bash
npx ts-node login.ts
```

或如果您使用 JavaScript：

```bash
node login.js
```

按照提示輸入您的手機號碼和驗證碼。成功後，您將看到輸出的會話字串。將其更新到 `.env` 檔案後，您就可以開始發送訊息了。

## 6. 步驟五：發送訊息給 @manus_ai_agent_bot 並監聽回應

現在您已經可以登入 Telegram，接下來我們將學習如何與 @manus_ai_agent_bot 互動，包括發送訊息和處理其回應。

### 6.1 程式碼範例：發送訊息

建立一個 `manus_interaction.ts` (或 `manus_interaction.js`) 檔案，並加入以下程式碼：

```typescript
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import 'dotenv/config';

const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
const apiHash = process.env.TELEGRAM_API_HASH || '';
const stringSession = new StringSession(process.env.TELEGRAM_SESSION || '');

const MANUS_BOT_USERNAME = 'manus_ai_agent_bot';

async function sendMessageToManus(messageText: string) {
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start();
  console.log('已登入 Telegram。');

  try {
    // 獲取 Manus Bot 的實體
    const manusBot = await client.getEntity(MANUS_BOT_USERNAME);

    // 發送訊息
    console.log(`正在發送訊息給 @${MANUS_BOT_USERNAME}: ${messageText}`);
    await client.sendMessage(manusBot, { message: messageText });
    console.log('訊息已發送。');

  } catch (error) {
    console.error('發送訊息失敗:', error);
  } finally {
    await client.disconnect();
    console.log('已斷開連線。');
  }
}

// 範例：發送一條訊息
sendMessageToManus('你好，Manus！請幫我總結一下最新的 AI 發展。').catch(console.error);
```

### 6.2 程式碼範例：監聽 Manus Bot 的回應

監聽訊息需要保持客戶端連線，並使用 `client.addEventHandler`。Telegram 的回應可能包含文字、圖片、文件等多種形式，也可能有多條訊息。

建立一個 `manus_listener.ts` (或 `manus_listener.js`) 檔案，並加入以下程式碼：

```typescript
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import 'dotenv/config';

const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
const apiHash = process.env.TELEGRAM_API_HASH || '';
const stringSession = new StringSession(process.env.TELEGRAM_SESSION || '');

const MANUS_BOT_USERNAME = 'manus_ai_agent_bot';

async function listenForManusResponses() {
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start();
  console.log('已登入 Telegram 並開始監聽訊息...');

  // 獲取 Manus Bot 的實體 ID，以便只監聽來自它的訊息
  const manusBot = await client.getEntity(MANUS_BOT_USERNAME);
  const manusBotId = manusBot.id;

  client.addEventHandler(async (event: NewMessageEvent) => {
    const message = event.message;

    // 檢查訊息是否來自 Manus Bot
    if (message.peerId && 'userId' in message.peerId && message.peerId.userId === manusBotId) {
      // 確保只處理在我們發送請求之後的回應
      // 這裡需要更精確的邏輯來判斷是否是當前請求的回應，例如基於時間戳或對話上下文
      // 為了簡化，我們假設所有來自 Manus 的新訊息都是當前請求的回應
      if (message.message) {
        console.log(`[execManus] 收到 Manus AI 回應片段: ${message.message.substring(0, 50)}...`);
      }
      // 處理附件，如果需要的話
      if (message.media) {
        // 這裡可以加入處理附件的邏輯，例如下載或記錄附件資訊
        console.log('[execManus] 收到 Manus AI 附件。');
      }
      // 您需要設計邏輯來判斷何時一個回應結束，例如等待一段時間沒有新訊息，或根據訊息內容判斷。
      console.log('-----------------------------------\n');
    }
  }, new NewMessage({})); // 監聽所有新訊息

  console.log('客戶端將保持連線以監聽訊息。請勿關閉此視窗。');
  // 為了保持程式運行並監聽訊息，我們需要一個無限循環或長時間等待
  // 在實際應用中，您會將此整合到一個長期運行的服務中
  // await new Promise(resolve => {}); // 永遠等待
}

listenForManusResponses().catch(console.error);
```

### 6.3 處理回應的注意事項

*   **多條訊息**：Manus AI 的回應有時會拆分成多條訊息發送（例如，先發送文字，再發送圖片）。在 `manus_listener.ts` 中，`NewMessageEvent` 會針對每一條新訊息觸發。您需要設計邏輯來判斷這些訊息是否屬於同一個「回應」。常見的做法是設定一個短時間的計時器，如果在一定時間內沒有收到新的來自 Manus AI 的訊息，就認為當前回應已結束。
*   **附件處理**：上述範例展示了如何判斷訊息是否包含媒體附件，以及如何獲取文件名稱。實際應用中，您可能需要呼叫 `client.downloadMedia(message.media)` 來下載圖片或文件，並將其保存到本地。
*   **錯誤處理**：在實際生產環境中，您需要更完善的錯誤處理機制，例如重試發送失敗的訊息，或記錄錯誤日誌。
*   **保持連線**：`listenForManusResponses` 函數會保持 Telegram 客戶端連線。在整合到 mini-agent 時，您需要確保這個監聽器在 mini-agent 運行期間持續工作。

現在，您已經掌握了如何使用 GramJS 登入 Telegram 帳號，以及如何發送訊息給 @manus_ai_agent_bot 並監聽其回應。下一步，我們將探討如何將這些功能整合到 mini-agent 專案中。

## 7. 步驟六：整合到 mini-agent

現在我們將把 Telegram 互動邏輯整合到您的 `mini-agent` 專案中，讓 `mini-agent` 可以透過 Telegram 與 Manus AI 進行溝通。

### 7.1 `execManus` 函數的完整實作

在 `mini-agent` 專案中，您可以建立一個新的檔案，例如 `src/telegramClient.ts`，來封裝 Telegram 的連線和訊息處理邏輯。這個檔案將包含一個 `execManus` 函數，負責發送訊息並等待 Manus AI 的回應。

**`src/telegramClient.ts`** (或類似的檔案)

```typescript
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import 'dotenv/config';

const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
const apiHash = process.env.TELEGRAM_API_HASH || '';
const stringSession = new StringSession(process.env.TELEGRAM_SESSION || '');

const MANUS_BOT_USERNAME = 'manus_ai_agent_bot';
const RESPONSE_TIMEOUT_MS = 60 * 1000; // 等待 Manus AI 回應的超時時間 (60 秒)
const RESPONSE_COLLECTION_DELAY_MS = 1000; // 判斷回應結束的延遲時間 (1 秒)

let client: TelegramClient | null = null;
let manusBotEntity: Api.User | null = null;

// 初始化 Telegram 客戶端並登入
async function initializeTelegramClient() {
  if (client && client.connected) {
    return client;
  }

  console.log('[TelegramClient] 正在初始化 Telegram 客戶端...');
  client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => {
      console.log('[TelegramClient] 請輸入您的手機號碼 (含國碼，例如 +886912345678):');
      return new Promise(resolve => process.stdin.once('data', data => resolve(data.toString().trim())));
    },
    password: async () => {
      console.log('[TelegramClient] 請輸入您的兩步驟驗證密碼 (如果沒有請留空):');
      return new Promise(resolve => process.stdin.once('data', data => resolve(data.toString().trim())));
    },
    phoneCode: async () => {
      console.log('[TelegramClient] 請輸入您 Telegram 應用程式收到的驗證碼:');
      return new Promise(resolve => process.stdin.once('data', data => resolve(data.toString().trim())));
    },
    onError: (err) => console.error('[TelegramClient] 登入錯誤:', err),
  });

  console.log('[TelegramClient] Telegram 客戶端已登入。');
  // 第一次登入後，保存新的 session 字串
  const newSession = client.session.save();
  if (newSession !== process.env.TELEGRAM_SESSION) {
    console.log('[TelegramClient] 新的會話字串已生成，請更新您的 .env 檔案:\nTELEGRAM_SESSION=' + newSession);
  }

  manusBotEntity = await client.getEntity(MANUS_BOT_USERNAME) as Api.User;
  return client;
}

// 發送訊息給 Manus AI 並等待回應
export async function execManus(prompt: string): Promise<string> {
  if (!client || !client.connected) {
    await initializeTelegramClient();
  }
  if (!client || !manusBotEntity) {
    throw new Error('Telegram 客戶端或 Manus Bot 實體未準備好。');
  }

  const manusBotId = manusBotEntity.id;
  let responseMessages: string[] = [];
  let responseComplete = false;
  let lastMessageTimestamp = Date.now();
  let timeoutId: NodeJS.Timeout;

  console.log(`[execManus] 正在發送請求給 Manus AI: ${prompt}`);
  await client.sendMessage(manusBotEntity, { message: prompt });

  // 監聽來自 Manus AI 的回應
  const handler = async (event: NewMessageEvent) => {
    const message = event.message;

    if (message.peerId && 'userId' in message.peerId && message.peerId.userId === manusBotId) {
      // 確保只處理在我們發送請求之後的回應
      // 這裡需要更精確的邏輯來判斷是否是當前請求的回應，例如基於時間戳或對話上下文
      // 為了簡化，我們假設所有來自 Manus 的新訊息都是當前請求的回應
      if (message.message) {
        responseMessages.push(message.message);
        console.log(`[execManus] 收到 Manus AI 回應片段: ${message.message.substring(0, 50)}...`);
      }
      // 處理附件，如果需要的話
      if (message.media) {
        // 這裡可以加入處理附件的邏輯，例如下載或記錄附件資訊
        console.log('[execManus] 收到 Manus AI 附件。');
      }
      lastMessageTimestamp = Date.now();

      // 重置超時計時器
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        responseComplete = true;
      }, RESPONSE_COLLECTION_DELAY_MS);
    }
  };

  client.addEventHandler(handler, new NewMessage({}));

  // 等待回應完成或超時
  const startTime = Date.now();
  while (!responseComplete && (Date.now() - startTime < RESPONSE_TIMEOUT_MS)) {
    await new Promise(resolve => setTimeout(resolve, 100)); // 短暫等待
  }

  // 移除事件處理器以避免重複觸發
  client.removeEventHandler(handler, new NewMessage({}));

  if (!responseComplete) {
    console.warn('[execManus] 等待 Manus AI 回應超時。');
  }

  const fullResponse = responseMessages.join('\n');
  console.log('[execManus] Manus AI 回應處理完成。');
  return fullResponse;
}

// 在應用程式關閉時斷開 Telegram 連線
export async function disconnectTelegramClient() {
  if (client && client.connected) {
    console.log('[TelegramClient] 正在斷開 Telegram 連線...');
    await client.disconnect();
    console.log('[TelegramClient] Telegram 連線已斷開。');
  }
}

// 確保在應用程式退出時斷開連線
process.on('exit', disconnectTelegramClient);
process.on('SIGINT', async () => {
  await disconnectTelegramClient();
  process.exit();
});
process.on('SIGTERM', async () => {
  await disconnectTelegramClient();
  process.exit();
});
```

### 7.2 整合到 `mini-agent` 的 `agent.ts`

假設您的 `mini-agent` 專案的 `agent.ts` 檔案中，有一個地方需要呼叫 LLM 來獲取回應。您可以將 `execManus` 函數整合進去。

1.  **修改 `agent.ts`**：
    在 `mini-agent` 專案的 `src/agent.ts` (或類似的檔案) 中，引入 `execManus` 函數。

    ```typescript
    // src/agent.ts (部分程式碼)
    import { execManus } from './telegramClient'; // 引入我們剛剛建立的函數

    // ... 其他 mini-agent 相關程式碼 ...

    async function runAgent(task: string) {
      console.log(`[Agent] 接收到任務: ${task}`);

      // 假設這裡需要呼叫 LLM
      try {
        console.log('[Agent] 正在向 Manus AI 請求回應...');
        const manusResponse = await execManus(task); // 將任務作為 prompt 發送給 Manus AI
        console.log('[Agent] 收到 Manus AI 回應:\n', manusResponse);
        // 在這裡處理 Manus AI 的回應，例如解析、執行下一步動作等
        return manusResponse;
      } catch (error) {
        console.error('[Agent] 呼叫 Manus AI 失敗:', error);
        return '無法從 Manus AI 獲取回應。';
      }
    }

    // ... 其他程式碼 ...
    ```

2.  **首次運行與會話保存**：
    第一次運行整合了 `execManus` 的 `mini-agent` 時，它會觸發 Telegram 登入流程，要求您輸入手機號碼和驗證碼。成功登入後，它會輸出新的 `TELEGRAM_SESSION` 字串。**請務必將這個字串複製並更新到您的 `.env` 檔案中。**之後的運行就不需要重複登入。

### 7.3 環境變數設定 (`.env`)

在您的 `mini-agent` 專案的根目錄下，確保 `dotenv` 已安裝 (`npm install dotenv`)，並建立或更新 `.env` 檔案，內容如下：

```dotenv
TELEGRAM_API_ID=您的_API_ID
TELEGRAM_API_HASH=您的_API_HASH
TELEGRAM_SESSION=您第一次登入後獲取的會話字串
```

*   `TELEGRAM_API_ID` 和 `TELEGRAM_API_HASH` 是您在步驟二中從 [my.telegram.org](https://my.telegram.org) 獲得的憑證。
*   `TELEGRAM_SESSION` 是您第一次運行 `initializeTelegramClient` (或 `login.ts`) 後，從控制台輸出中獲取並保存的長字串。

## 8. 注意事項與常見問題

### 8.1 Userbot 的風險 (封號可能)

您正在建立的是一個「Userbot」，它模擬一個普通用戶的行為，而不是官方的 Bot API。Telegram 對於 Userbot 有嚴格的使用條款。濫用 Userbot 可能會導致您的帳號被限制甚至永久封禁。請務必注意以下幾點：

*   **避免頻繁操作**：不要在短時間內發送大量訊息或執行過於頻繁的操作。
*   **遵守使用條款**：確保您的 Userbot 行為符合 Telegram 的服務條款。
*   **僅用於個人用途**：最好將此 Userbot 限制在個人或小範圍的測試用途，避免用於商業或大規模自動化。

### 8.2 頻率限制怎麼處理

Telegram 對於 API 請求有頻率限制 (Rate Limits)。如果您的請求過於頻繁，可能會收到 `FloodWait` 錯誤。GramJS 通常會自動處理這些錯誤並等待一段時間後重試，但您也應該在設計 `mini-agent` 的邏輯時考慮到這一點：

*   **增加延遲**：在連續發送訊息之間加入適當的延遲 (例如幾秒)。
*   **錯誤處理**：在 `execManus` 函數中，您可以加入更詳細的錯誤處理，特別是針對 `FloodWait` 錯誤，可以記錄日誌並等待更長時間。

### 8.3 session 檔案的安全保管

`TELEGRAM_SESSION` 字串包含了您 Telegram 帳號的登入憑證。如果洩露，他人可以利用它登入您的帳號。因此，請務必：

*   **使用 `.env` 檔案**：將 `TELEGRAM_SESSION` 儲存在 `.env` 檔案中，並將 `.env` 加入到 `.gitignore`，避免將其提交到版本控制系統 (如 Git)。
*   **限制存取**：確保您的 `.env` 檔案和運行程式的伺服器環境是安全的，只有授權用戶才能存取。
*   **定期更換**：如果懷疑會話字串可能已洩露，請立即在 [my.telegram.org](https://my.telegram.org) 撤銷所有授權，並重新生成新的會話字串。

### 8.4 除錯技巧

*   **詳細日誌**：在 `telegramClient.ts` 和 `agent.ts` 中加入足夠的 `console.log` 訊息，以便追蹤程式的執行流程和 Telegram API 的互動情況。
*   **錯誤捕獲**：確保所有異步操作都有 `try...catch` 區塊來捕獲和處理錯誤。
*   **逐步測試**：先單獨測試 `login.ts` 確保能成功登入並獲取會話字串，然後再測試 `manus_interaction.ts` 的發送功能，最後再整合到 `mini-agent`。
*   **GramJS 文件**：查閱 [GramJS 官方文件](https://gram.js.org/) 以獲取更詳細的 API 使用方法和除錯資訊。

## 參考資料

*   [GramJS 官方文件](https://gram.js.org/) - GramJS 的官方文件，包含詳細的 API 說明和範例。
*   [Telegram API 開發者網站](https://my.telegram.org/) - 申請 Telegram API ID 和 API Hash 的官方網站。
*   [BotFather](https://t.me/BotFather) - Telegram 官方 Bot，用於建立和管理您的 Telegram Bot。

希望這份教學指南能幫助您成功整合 mini-agent 與 Manus AI！如果您在實作過程中遇到任何問題，請隨時查閱相關文件或尋求協助。
