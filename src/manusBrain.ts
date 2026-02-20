import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { CustomFile } from 'telegram/client/uploads';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
const apiHash = process.env.TELEGRAM_API_HASH || '';
let stringSession = new StringSession(process.env.TELEGRAM_SESSION || '');

const MANUS_BOT_USERNAME = process.env.MANUS_BOT_USERNAME || 'manus_ai_agent_bot';
const RESPONSE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const RESPONSE_COLLECTION_DELAY_MS = 1000; // 1 second
const MAX_TEXT_LENGTH = 4096; // Telegram message text limit

let client: TelegramClient | null = null;
let manusBotEntity: Api.User | null = null;

interface ManusResponse {
  response: string;
  attachments: string[]; // Local file paths of downloaded attachments
}

// Initialize Telegram client and login
export async function initManusClient() {
  if (client && client.connected) {
    return client;
  }

  console.log('[ManusBrain] Initializing Telegram client...');
  client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => {
      console.log('[ManusBrain] Please enter your phone number (e.g., +886912345678):');
      return new Promise(resolve => process.stdin.once('data', data => resolve(data.toString().trim())));
    },
    password: async () => {
      console.log('[ManusBrain] Please enter your 2FA password (leave empty if none):');
      return new Promise(resolve => process.stdin.once('data', data => resolve(data.toString().trim())));
    },
    phoneCode: async () => {
      console.log('[ManusBrain] Please enter the verification code received in your Telegram app:');
      return new Promise(resolve => process.stdin.once('data', data => resolve(data.toString().trim())));
    },
    onError: (err) => console.error('[ManusBrain] Login error:', err),
  });

  console.log('[ManusBrain] Telegram client logged in.');
  const newSession = client.session.save();
  if (newSession !== process.env.TELEGRAM_SESSION) {
    console.log('[ManusBrain] New session string generated. Please update your .env file:\nTELEGRAM_SESSION=' + newSession);
    stringSession = new StringSession(newSession); // Update in-memory session
  }

  manusBotEntity = await client.getEntity(MANUS_BOT_USERNAME) as Api.User;
  return client;
}

// Disconnect Telegram client
export async function disconnectManusClient() {
  if (client && client.connected) {
    console.log('[ManusBrain] Disconnecting Telegram client...');
    await client.disconnect();
    console.log('[ManusBrain] Telegram client disconnected.');
  }
}

// Send message to Manus AI and wait for response
export async function execManus(prompt: string): Promise<ManusResponse> {
  if (!client || !client.connected) {
    await initManusClient();
  }
  if (!client || !manusBotEntity) {
    throw new Error('Telegram client or Manus Bot entity not ready.');
  }

  const manusBotId = manusBotEntity.id;
  let responseMessages: string[] = [];
  let responseAttachments: string[] = [];
  let responseComplete = false;
  let lastMessageTimestamp = Date.now();
  let timeoutId: NodeJS.Timeout | null = null;
  let resolveResponse: ((value: ManusResponse) => void) | null = null;
  let rejectResponse: ((reason?: any) => void) | null = null;

  const responsePromise = new Promise<ManusResponse>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });

  const handler = async (event: NewMessageEvent) => {
    const message = event.message;

    if (message.peerId && 'userId' in message.peerId && message.peerId.userId === manusBotId) {
      // Check if the message is a reply to our sent message or part of the ongoing conversation
      // For simplicity, we assume any new message from Manus after our prompt is a response.
      // More robust logic might involve tracking message IDs or conversation context.
      if (message.message) {
        responseMessages.push(message.message);
        console.log(`[ManusBrain] Received Manus AI response fragment: ${message.message.substring(0, Math.min(message.message.length, 50))}...`);
      }

      if (message.media) {
        console.log('[ManusBrain] Received Manus AI attachment. Downloading...');
        try {
          const buffer = await client!.downloadMedia(message.media);
          if (buffer) {
            const fileName = getFileNameFromMedia(message.media) || `attachment_${Date.now()}`;
            const attachmentPath = path.join(process.cwd(), 'manus_attachments', fileName);
            if (!existsSync(path.dirname(attachmentPath))) {
              mkdirSync(path.dirname(attachmentPath), { recursive: true });
            }
            writeFileSync(attachmentPath, buffer);
            responseAttachments.push(attachmentPath);
            console.log(`[ManusBrain] Attachment saved to: ${attachmentPath}`);
          }
        } catch (downloadError) {
          console.error('[ManusBrain] Failed to download attachment:', downloadError);
        }
      }
      lastMessageTimestamp = Date.now();

      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        responseComplete = true;
        if (resolveResponse) {
          resolveResponse({ response: responseMessages.join('\n'), attachments: responseAttachments });
        }
      }, RESPONSE_COLLECTION_DELAY_MS);
    }
  };

  client.addEventHandler(handler, new NewMessage({}));

  console.log(`[ManusBrain] Sending request to Manus AI: ${prompt.substring(0, Math.min(prompt.length, 100))}...`);

  // Handle long text by sending as file
  if (prompt.length > MAX_TEXT_LENGTH) {
    const tempFilePath = path.join(process.cwd(), `manus_prompt_${Date.now()}.txt`);
    writeFileSync(tempFilePath, prompt);
    const file = new CustomFile(path.basename(tempFilePath), readFileSync(tempFilePath).length, path.basename(tempFilePath), tempFilePath);
    await client.sendFile(manusBotEntity, { file: file, caption: 'Prompt too long, sent as file.' });
    console.log(`[ManusBrain] Prompt sent as file: ${tempFilePath}`);
  } else {
    await client.sendMessage(manusBotEntity, { message: prompt });
  }

  // Set a global timeout for the entire response collection process
  const globalTimeout = setTimeout(() => {
    if (!responseComplete) {
      console.warn('[ManusBrain] Waiting for Manus AI response timed out.');
      if (rejectResponse) {
        rejectResponse(new Error('Manus AI response timed out.'));
      }
      responseComplete = true; // Mark as complete to exit while loop
    }
  }, RESPONSE_TIMEOUT_MS);

  // Wait for response to complete or global timeout
  await responsePromise;

  // Clean up
  if (timeoutId) clearTimeout(timeoutId);
  clearTimeout(globalTimeout);
  client.removeEventHandler(handler, new NewMessage({}));

  console.log('[ManusBrain] Manus AI response processing complete.');
  return { response: responseMessages.join('\n'), attachments: responseAttachments };
}

function getFileNameFromMedia(media: Api.MessageMedia): string | undefined {
  if (media instanceof Api.MessageMediaDocument) {
    const document = media.document as Api.Document;
    const fileNameAttribute = document.attributes.find(
      (attr): attr is Api.DocumentAttributeFilename => attr instanceof Api.DocumentAttributeFilename
    );
    return fileNameAttribute?.fileName;
  } else if (media instanceof Api.MessageMediaPhoto) {
    return `photo_${media.photo?.id}.jpg`;
  }
  return undefined;
}

// Ensure disconnect on process exit
process.on('exit', async () => {
  await disconnectManusClient();
});
process.on('SIGINT', async () => {
  await disconnectManusClient();
  process.exit();
});
process.on('SIGTERM', async () => {
  await disconnectManusClient();
  process.exit();
});
