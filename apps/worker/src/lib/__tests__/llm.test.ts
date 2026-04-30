import { describe, expect, it } from "vitest";
import { type GatewayMetadata, gatewayMetadataHeader } from "@/lib/llm";

describe("gatewayMetadataHeader", () => {
  it("produces correct header for dispatcher source", () => {
    const metadata: GatewayMetadata = {
      source: "dispatcher",
      conversationId: "sms:+1234",
      turnId: "turn_abc",
    };
    const headers = gatewayMetadataHeader(metadata);
    expect(headers).toEqual({ "cf-aig-metadata": JSON.stringify(metadata) });
  });

  it("produces correct header for execution source", () => {
    const metadata: GatewayMetadata = {
      source: "execution",
      conversationId: "sms:+1234",
      agentId: "agent_xyz",
    };
    const headers = gatewayMetadataHeader(metadata);
    expect(headers).toEqual({ "cf-aig-metadata": JSON.stringify(metadata) });
  });

  it("produces correct header for extract source", () => {
    const metadata: GatewayMetadata = {
      source: "extract",
      conversationId: "sms:+1234",
      turnId: "turn_abc",
    };
    const headers = gatewayMetadataHeader(metadata);
    expect(headers).toEqual({ "cf-aig-metadata": JSON.stringify(metadata) });
  });

  it("rejects invalid source at compile time", () => {
    // @ts-expect-error — "unknown" is not a valid source
    gatewayMetadataHeader({ source: "unknown", conversationId: "x" });
  });

  it("rejects missing required fields at compile time", () => {
    // @ts-expect-error — execution requires agentId, not turnId
    gatewayMetadataHeader({ source: "execution", conversationId: "x", turnId: "t" });
  });
});
