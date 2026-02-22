import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

// BastionClaw webhook endpoint
http.route({
	path: "/bastionclaw/event",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		const body = await request.json();
		await ctx.runMutation(api.bastionclaw.receiveAgentEvent, body);
		return new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}),
});

export default http;
