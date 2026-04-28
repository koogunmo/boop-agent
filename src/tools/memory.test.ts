import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { injectMocksIntoDO, mockConvex } from "../lib/test-helpers";
import { SEGMENT_DEFAULTS } from "../memory/types";

const replyResponse = z.object({ reply: z.string() });

function getStub(name: string) {
  return env.BOOP_AGENT.get(env.BOOP_AGENT.idFromName(name));
}

async function sendMessage(stub: DurableObjectStub, content: string) {
  return stub.fetch("http://agent/handle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId: "test:mem", content }),
  });
}

describe("memory tools via interaction agent", () => {
  it("tools are included and agent responds", async () => {
    const convex = mockConvex([]);
    const stub = getStub("t-tools-exist");
    await injectMocksIntoDO(stub, convex, "hello");

    const res = await sendMessage(stub, "hi");
    expect(res.status).toBe(200);
    const body = replyResponse.parse(await res.json());
    expect(body.reply).toBeTruthy();
  });
});

describe("SEGMENT_DEFAULTS", () => {
  it("identity defaults to permanent tier", () => {
    expect(SEGMENT_DEFAULTS.identity.tier).toBe("permanent");
  });

  it("context defaults to short tier", () => {
    expect(SEGMENT_DEFAULTS.context.tier).toBe("short");
  });

  it("preference defaults to long tier", () => {
    expect(SEGMENT_DEFAULTS.preference.tier).toBe("long");
  });

  it("correction defaults to long tier", () => {
    expect(SEGMENT_DEFAULTS.correction.tier).toBe("long");
  });

  it("all segments have importance between 0 and 1", () => {
    for (const [, defaults] of Object.entries(SEGMENT_DEFAULTS)) {
      expect(defaults.importance).toBeGreaterThanOrEqual(0);
      expect(defaults.importance).toBeLessThanOrEqual(1);
    }
  });

  it("identity has highest importance", () => {
    expect(SEGMENT_DEFAULTS.identity.importance).toBeGreaterThan(
      SEGMENT_DEFAULTS.preference.importance,
    );
    expect(SEGMENT_DEFAULTS.identity.importance).toBeGreaterThan(
      SEGMENT_DEFAULTS.context.importance,
    );
  });

  it("context has lowest importance", () => {
    for (const [segment, defaults] of Object.entries(SEGMENT_DEFAULTS)) {
      if (segment !== "context") {
        expect(defaults.importance).toBeGreaterThan(SEGMENT_DEFAULTS.context.importance);
      }
    }
  });
});
