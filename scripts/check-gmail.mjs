// Verify which actual Gmail account each connected Composio connection ID
// resolves to. Useful when the Connections panel shows duplicate-looking rows
// and you need to confirm which OAuth grant maps to which inbox.
//
// Run with: node --env-file=.env.local scripts/check-gmail.mjs
import { Composio } from "@composio/core";

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
const userId = process.env.COMPOSIO_USER_ID || "boop-default";
const all = await composio.connectedAccounts.list({ userIds: [userId] });
const gmail = all.items.filter((it) => it.toolkit?.slug === "gmail");
console.log(`Total Gmail records (any status): ${gmail.length}`);

for (const it of gmail) {
  let scopedEmail = "(unknown)";
  try {
    const r = await composio.tools.execute("GMAIL_GET_PROFILE", {
      userId,
      connectedAccountId: it.id,
      arguments: { user_id: "me" },
      dangerouslySkipVersionCheck: true,
    });
    if (r.successful && r.data) {
      scopedEmail = r.data.emailAddress ?? JSON.stringify(r.data);
    }
  } catch {
    // Identity lookup is best-effort; skip rows the API can't resolve.
  }
  console.log(
    JSON.stringify({
      id: it.id,
      status: it.status,
      createdAt: it.createdAt,
      email: scopedEmail,
    }),
  );
}
