import { parsePhoneNumber } from "libphonenumber-js";
import removeMarkdown from "remove-markdown";
import SendblueAPI from "sendblue";

const MAX_CHUNK = 2900;

function createClient(env: Env): SendblueAPI | null {
  if (!env.SENDBLUE_API_KEY || !env.SENDBLUE_API_SECRET) return null;
  return new SendblueAPI({
    apiKey: env.SENDBLUE_API_KEY,
    apiSecret: env.SENDBLUE_API_SECRET,
  });
}

function normalizeE164(n: string | undefined): string | undefined {
  if (!n) return undefined;
  const trimmed = n.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = parsePhoneNumber(trimmed, "US");
    if (parsed) return parsed.format("E.164");
  } catch {
    // not a valid phone number
  }
  return trimmed;
}

export function chunk(text: string, size = MAX_CHUNK): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let buf = "";
  for (const line of text.split(/\n/)) {
    if (`${buf}\n${line}`.length > size) {
      if (buf) out.push(buf);
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

export async function sendImessage(env: Env, toNumber: string, text: string): Promise<void> {
  const client = createClient(env);
  if (!client) {
    console.warn("[sendblue] missing credentials — not sending");
    return;
  }
  const from = normalizeE164(env.SENDBLUE_FROM_NUMBER);
  if (!from) {
    console.error("[sendblue] SENDBLUE_FROM_NUMBER is not set");
    return;
  }
  const plain = removeMarkdown(text);
  for (const part of chunk(plain)) {
    try {
      const response = await client.messages.send({
        number: toNumber,
        content: part,
        from_number: from,
      });
      if (response.status === "ERROR") {
        console.error(`[sendblue] send error: ${response.error_message}`);
      } else {
        console.log(`[sendblue] → sent ${part.length} chars to ${toNumber}`);
      }
    } catch (err) {
      console.error(`[sendblue] send failed: ${err}`);
    }
  }
}

export async function sendTypingIndicator(env: Env, toNumber: string): Promise<void> {
  const client = createClient(env);
  if (!client) return;
  const from = normalizeE164(env.SENDBLUE_FROM_NUMBER);
  if (!from) return;
  try {
    await client.typingIndicators.send({
      number: toNumber,
      from_number: from,
    });
  } catch {
    /* non-fatal */
  }
}
