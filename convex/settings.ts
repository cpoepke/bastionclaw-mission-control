import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";

export const get = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const setting = await ctx.db
      .query("settings")
      .filter((q) => q.eq(q.field("key"), args.key))
      .first();
    return setting?.value ?? null;
  },
});

export const set = mutation({
  args: { key: v.string(), value: v.boolean() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .filter((q) => q.eq(q.field("key"), args.key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value });
    } else {
      await ctx.db.insert("settings", { key: args.key, value: args.value });
    }
  },
});

export const autoArchiveDoneTasks = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Check if auto-archive is enabled (default: true)
    const setting = await ctx.db
      .query("settings")
      .filter((q) => q.eq(q.field("key"), "autoArchive24h"))
      .first();
    // Default to enabled if no setting exists
    if (setting && setting.value === false) return;

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const doneTasks = await ctx.db
      .query("tasks")
      .filter((q) => q.eq(q.field("status"), "done"))
      .collect();

    for (const task of doneTasks) {
      if (task.pinned) continue;
      const doneAt = task.doneAt ?? task._creationTime;
      if (doneAt < cutoff) {
        await ctx.db.patch(task._id, { status: "archived" });
      }
    }
  },
});
