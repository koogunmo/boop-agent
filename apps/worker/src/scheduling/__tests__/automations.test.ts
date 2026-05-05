import { describe, expect, it, vi } from "vitest";
import { cvx, mockConvex, testEnv } from "@/lib/test-helpers";
import { runAutomation } from "@/scheduling/automations";

const mockBroadcast = vi.fn();

describe("runAutomation", () => {
  it("returns null when automation is not found", async () => {
    const convex = mockConvex([]);
    const result = await runAutomation({
      automationId: "auto_missing",
      userTimezone: "America/Chicago",
      env: testEnv(),
      convex: cvx(convex),
      broadcast: mockBroadcast,
      schedule: vi.fn(),
    });
    expect(result).toBeNull();
  });

  it("returns null when automation is disabled", async () => {
    const convex = mockConvex([
      {
        automationId: "auto_1",
        enabled: false,
        name: "test",
        schedule: "0 8 * * *",
        task: "do it",
        integrations: [],
      },
    ]);
    const result = await runAutomation({
      automationId: "auto_1",
      userTimezone: "America/Chicago",
      env: testEnv(),
      convex: cvx(convex),
      broadcast: mockBroadcast,
      schedule: vi.fn(),
    });
    expect(result).toBeNull();
  });
});
