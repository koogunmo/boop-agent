import { describe, expect, it } from "vitest";
import { extractAccountIdentity, FEATURED_SLUGS } from "@/lib/composio";

describe("FEATURED_SLUGS", () => {
  it("contains expected featured toolkits", () => {
    expect(FEATURED_SLUGS.has("gmail")).toBe(true);
    expect(FEATURED_SLUGS.has("slack")).toBe(true);
    expect(FEATURED_SLUGS.has("github")).toBe(true);
    expect(FEATURED_SLUGS.has("twitter")).toBe(true);
  });

  it("has 23 entries", () => {
    expect(FEATURED_SLUGS.size).toBe(23);
  });
});

describe("extractAccountIdentity", () => {
  it("returns empty identity for empty state and data", () => {
    const result = extractAccountIdentity({}, {});
    expect(result.label).toBeUndefined();
    expect(result.email).toBeUndefined();
  });

  it("extracts identity from OAuth id_token JWT in state", () => {
    const payload = {
      email: "user@example.com",
      name: "Test User",
      picture: "https://photo.url",
    };
    const encodedPayload = btoa(JSON.stringify(payload));
    const fakeJwt = `header.${encodedPayload}.signature`;

    const result = extractAccountIdentity({ id_token: fakeJwt }, {});
    expect(result.email).toBe("user@example.com");
    expect(result.name).toBe("Test User");
    expect(result.avatarUrl).toBe("https://photo.url");
    expect(result.label).toBe("user@example.com");
  });

  it("extracts identity from id_token in data when state has none", () => {
    const payload = { email: "data@example.com" };
    const fakeJwt = `h.${btoa(JSON.stringify(payload))}.s`;

    const result = extractAccountIdentity({}, { id_token: fakeJwt });
    expect(result.email).toBe("data@example.com");
    expect(result.label).toBe("data@example.com");
  });

  it("extracts from user_info profile blob", () => {
    const result = extractAccountIdentity(
      {},
      {
        user_info: {
          email: "profile@test.com",
          name: "Profile Name",
          avatar_url: "https://av.url",
        },
      },
    );
    expect(result.email).toBe("profile@test.com");
    expect(result.name).toBe("Profile Name");
    expect(result.avatarUrl).toBe("https://av.url");
  });

  it("extracts from top-level fields in data", () => {
    const result = extractAccountIdentity({}, { email: "top@test.com", display_name: "Top User" });
    expect(result.email).toBe("top@test.com");
    expect(result.name).toBe("Top User");
    expect(result.label).toBe("top@test.com");
  });

  it("falls back to shop/subdomain from state", () => {
    const result = extractAccountIdentity({ shop: "mystore.myshopify.com" }, {});
    expect(result.label).toBe("mystore.myshopify.com");
  });

  it("prefers email over name for label", () => {
    const result = extractAccountIdentity({}, { email: "email@test.com", name: "Name" });
    expect(result.label).toBe("email@test.com");
  });

  it("uses name as label when no email", () => {
    const result = extractAccountIdentity({}, { name: "Just Name" });
    expect(result.label).toBe("Just Name");
  });

  it("handles invalid JWT gracefully", () => {
    const result = extractAccountIdentity({ id_token: "not.a.jwt" }, {});
    expect(result.label).toBeUndefined();
  });

  it("handles non-string values without crashing", () => {
    const result = extractAccountIdentity(
      { email: 123, name: null, id_token: false },
      { email: undefined, avatar_url: {} },
    );
    expect(result.label).toBeUndefined();
  });

  it("extracts from nested profile object in state", () => {
    const result = extractAccountIdentity(
      { profile: { email: "nested@state.com", name: "Nested" } },
      {},
    );
    expect(result.email).toBe("nested@state.com");
  });

  it("prefers id_token over raw fields", () => {
    const payload = { email: "jwt@test.com" };
    const fakeJwt = `h.${btoa(JSON.stringify(payload))}.s`;
    const result = extractAccountIdentity({ id_token: fakeJwt }, { email: "raw@test.com" });
    expect(result.email).toBe("jwt@test.com");
  });
});
