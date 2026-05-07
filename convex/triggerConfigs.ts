import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("triggerConfigs").collect();
  },
});

export const getBySlug = query({
  args: { triggerSlug: v.string(), connectedAccountId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("triggerConfigs")
      .withIndex("by_slug", (q) => q.eq("triggerSlug", args.triggerSlug))
      .filter((q) => q.eq(q.field("connectedAccountId"), args.connectedAccountId))
      .unique();
  },
});

export const upsert = mutation({
  args: {
    triggerSlug: v.string(),
    connectedAccountId: v.string(),
    appSlug: v.string(),
    template: v.string(),
    enabled: v.boolean(),
    composioTriggerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("triggerConfigs")
      .withIndex("by_slug", (q) => q.eq("triggerSlug", args.triggerSlug))
      .filter((q) => q.eq(q.field("connectedAccountId"), args.connectedAccountId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        template: args.template,
        enabled: args.enabled,
        ...(args.composioTriggerId ? { composioTriggerId: args.composioTriggerId } : {}),
      });
      return existing._id;
    }
    return await ctx.db.insert("triggerConfigs", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const setEnabled = mutation({
  args: { triggerSlug: v.string(), connectedAccountId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("triggerConfigs")
      .withIndex("by_slug", (q) => q.eq("triggerSlug", args.triggerSlug))
      .filter((q) => q.eq(q.field("connectedAccountId"), args.connectedAccountId))
      .unique();
    if (!existing) return null;
    await ctx.db.patch(existing._id, { enabled: args.enabled });
    return existing._id;
  },
});

export const setTemplate = mutation({
  args: { triggerSlug: v.string(), connectedAccountId: v.string(), template: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("triggerConfigs")
      .withIndex("by_slug", (q) => q.eq("triggerSlug", args.triggerSlug))
      .filter((q) => q.eq(q.field("connectedAccountId"), args.connectedAccountId))
      .unique();
    if (!existing) return null;
    await ctx.db.patch(existing._id, { template: args.template });
    return existing._id;
  },
});

export const remove = mutation({
  args: { triggerSlug: v.string(), connectedAccountId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("triggerConfigs")
      .withIndex("by_slug", (q) => q.eq("triggerSlug", args.triggerSlug))
      .filter((q) => q.eq(q.field("connectedAccountId"), args.connectedAccountId))
      .unique();
    if (!existing) return null;
    await ctx.db.delete(existing._id);
    return existing._id;
  },
});
