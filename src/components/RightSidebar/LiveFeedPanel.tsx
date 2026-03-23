import React, { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import type { Activity, Agent } from "../../types";

function formatRelativeTime(timestamp: string, now: number): string {
	const diff = now - new Date(timestamp).getTime();
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (seconds < 60) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 7) return `${days}d ago`;

	return new Date(timestamp).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

const filters = [
	{ id: "all", label: "All" },
	{ id: "tasks", label: "Tasks" },
	{ id: "comments", label: "Comments" },
	{ id: "decisions", label: "Decisions" },
	{ id: "docs", label: "Docs" },
	{ id: "status", label: "Status" },
];

const LiveFeedPanel: React.FC = () => {
	const [selectedType, setSelectedType] = useState<string>("all");
	const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
	const [now, setNow] = useState(Date.now());
	const [activities, setActivities] = useState<Activity[] | undefined>(undefined);
	const [agents, setAgents] = useState<Agent[] | undefined>(undefined);

	useEffect(() => {
		const interval = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(interval);
	}, []);

	useEffect(() => {
		const load = () => {
			let query = supabase
				.from("mc_activities")
				.select("*, mc_agents!agent_id(name)")
				.order("created_at", { ascending: false })
				.limit(100);

			if (selectedType !== "all") query = query.eq("type", selectedType);
			if (selectedAgentId) query = query.eq("agent_id", selectedAgentId);

			query.then(({ data }) =>
				setActivities(
					(data ?? []).map((a: Record<string, unknown>) => ({
						...(a as Activity),
						agent_name: (a.mc_agents as { name?: string } | null)?.name,
					})),
				),
			);
		};

		load();
		const ch = supabase
			.channel(`live_feed_${selectedType}_${selectedAgentId ?? "all"}`)
			.on("postgres_changes", { event: "*", schema: "public", table: "mc_activities" }, load)
			.subscribe();
		return () => { supabase.removeChannel(ch); };
	}, [selectedType, selectedAgentId]);

	useEffect(() => {
		const load = () =>
			supabase
				.from("mc_agents")
				.select("*")
				.then(({ data }) => setAgents(data ?? []));
		load();
		const ch = supabase
			.channel("live_feed_agents")
			.on("postgres_changes", { event: "*", schema: "public", table: "mc_agents" }, load)
			.subscribe();
		return () => { supabase.removeChannel(ch); };
	}, []);

	if (activities === undefined || agents === undefined) {
		return (
			<div className="flex-1 flex flex-col overflow-hidden animate-pulse">
				<div className="flex-1 p-4 space-y-4">
					{[...Array(6)].map((_, i) => (
						<div key={i} className="h-16 bg-muted rounded-lg" />
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="flex-1 flex flex-col overflow-y-auto p-4 gap-5">
			<div className="flex flex-col gap-4">
				<div className="flex flex-wrap gap-1.5">
					{filters.map((f) => (
						<div
							key={f.id}
							onClick={() => setSelectedType(f.id)}
							className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border border-border cursor-pointer flex items-center gap-1 transition-colors ${
								selectedType === f.id
									? "bg-[var(--accent-orange)] text-white border-[var(--accent-orange)]"
									: "bg-muted text-muted-foreground hover:bg-muted/80"
							}`}
						>
							{f.label}
						</div>
					))}
				</div>

				<div className="flex flex-wrap gap-1.5">
					<div
						onClick={() => setSelectedAgentId(undefined)}
						className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border cursor-pointer transition-colors ${
							selectedAgentId === undefined
								? "border-[var(--accent-orange)] text-[var(--accent-orange)] bg-white"
								: "border-border bg-white text-muted-foreground hover:bg-muted/50"
						}`}
					>
						All Agents
					</div>
					{agents.slice(0, 8).map((a) => (
						<div
							key={a.id}
							onClick={() => setSelectedAgentId(a.id)}
							className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border cursor-pointer flex items-center gap-1 transition-colors ${
								selectedAgentId === a.id
									? "border-[var(--accent-orange)] text-[var(--accent-orange)] bg-white"
									: "border-border bg-white text-muted-foreground hover:bg-muted/50"
							}`}
						>
							{a.name}
						</div>
					))}
				</div>
			</div>

			<div className="flex flex-col gap-3">
				{activities.map((item) => (
					<div
						key={item.id}
						className="flex gap-3 p-3 bg-secondary border border-border rounded-lg"
					>
						<div className="w-1.5 h-1.5 bg-[var(--accent-orange)] rounded-full mt-1.5 shrink-0" />
						<div className="text-xs leading-tight text-foreground">
							<span className="font-bold text-[var(--accent-orange)]">
								{item.agent_name}
							</span>{" "}
							{item.message}
							<div className="text-[10px] text-muted-foreground mt-1">
								{formatRelativeTime(item.created_at, now)}
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
};

export default LiveFeedPanel;
