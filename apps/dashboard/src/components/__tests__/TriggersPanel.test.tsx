import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@boop/convex", () => ({
  api: {
    triggerConfigs: {
      list: "triggerConfigs:list",
      upsert: "triggerConfigs:upsert",
      setEnabled: "triggerConfigs:setEnabled",
      setTemplate: "triggerConfigs:setTemplate",
    },
  },
}));

vi.mock("convex/react", () => ({
  useQuery: vi.fn().mockReturnValue([]),
  useMutation: vi.fn().mockReturnValue(vi.fn()),
}));

function mockToolkitsApi(toolkits: unknown[]) {
  vi.doMock("@/lib/api", () => ({
    rpc: {
      api: {
        composio: {
          toolkits: {
            $get: vi.fn().mockResolvedValue({
              ok: true,
              json: () => Promise.resolve({ toolkits }),
            }),
          },
        },
      },
    },
  }));
}

const gmailToolkit = {
  slug: "gmail",
  displayName: "Gmail",
  logoUrl: null,
  connections: [
    {
      connectionId: "conn_1",
      accountLabel: "work@example.com",
      accountEmail: null,
      accountName: null,
      alias: null,
      status: "ACTIVE",
    },
  ],
};

const gmailTrigger = { slug: "GMAIL_NEW_GMAIL_MESSAGE", name: "New Email", appSlug: "gmail" };

const originalFetch = globalThis.fetch;

describe("TriggersPanel", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it("renders loading state initially", async () => {
    mockToolkitsApi([gmailToolkit]);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ triggers: [gmailTrigger] }),
    });

    const { TriggersPanel } = await import("../TriggersPanel");
    render(<TriggersPanel isDark={false} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("renders toolkit as details element after data loads", async () => {
    mockToolkitsApi([gmailToolkit]);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ triggers: [gmailTrigger] }),
    });

    const { TriggersPanel } = await import("../TriggersPanel");
    const { container } = render(<TriggersPanel isDark={false} />);

    await vi.waitFor(() => {
      expect(screen.getByText("Gmail")).toBeTruthy();
    });

    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(within(details).getByText("Gmail")).toBeTruthy();
    expect(within(details).getByText("New Email")).toBeTruthy();
  });

  it("shows empty state when no integrations have trigger support", async () => {
    mockToolkitsApi([]);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ triggers: [] }),
    });

    const { TriggersPanel } = await import("../TriggersPanel");
    render(<TriggersPanel isDark={false} />);

    await vi.waitFor(() => {
      expect(screen.getByText(/no connected integrations/i)).toBeTruthy();
    });
  });

  it("renders a toggle switch per trigger defaulting to off", async () => {
    mockToolkitsApi([gmailToolkit]);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ triggers: [gmailTrigger] }),
    });

    const { TriggersPanel } = await import("../TriggersPanel");
    render(<TriggersPanel isDark={false} />);

    await vi.waitFor(() => {
      expect(screen.getByText("Gmail")).toBeTruthy();
    });

    const toggle = screen.getByRole("switch");
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("renders account selector when toolkit has multiple connections", async () => {
    const multiAccountToolkit = {
      ...gmailToolkit,
      connections: [
        { ...gmailToolkit.connections[0] },
        {
          connectionId: "conn_2",
          accountLabel: "personal@example.com",
          accountEmail: null,
          accountName: null,
          alias: null,
          status: "ACTIVE",
        },
      ],
    };

    mockToolkitsApi([multiAccountToolkit]);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ triggers: [gmailTrigger] }),
    });

    const { TriggersPanel } = await import("../TriggersPanel");
    render(<TriggersPanel isDark={false} />);

    await vi.waitFor(() => {
      expect(screen.getByText("Gmail")).toBeTruthy();
    });

    const select = screen.getByRole("combobox");
    expect(select).toBeTruthy();
    const options = within(select).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]?.textContent).toBe("work@example.com");
    expect(options[1]?.textContent).toBe("personal@example.com");
  });
});
