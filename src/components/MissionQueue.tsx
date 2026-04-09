import React, { useState, useEffect } from "react";
import { IconArchive, IconClock } from "@tabler/icons-react";
import {
	DndContext,
	DragOverlay,
	PointerSensor,
	useSensor,
	useSensors,
	type DragStartEvent,
	type DragEndEvent,
} from "@dnd-kit/core";
import { supabase } from "../lib/supabase";
import type { Task, Agent } from "../types";
import TaskCard from "./TaskCard";
import KanbanColumn from "./KanbanColumn";

type TaskStatus =
	| "inbox"
	| "assigned"
	| "in_progress"
	| "review"
	| "done"
	| "archived";

function formatRelativeTime(timestamp: number | null): string {
	if (!timestamp) return "";

	const now = Date.now();
	const diff = now - timestamp;

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

const columns = [
	{ id: "inbox", label: "INBOX", color: "var(--text-subtle)" },
	{ id: "assigned", label: "ASSIGNED", color: "var(--accent-orange)" },
	{ id: "in_progress", label: "IN PROGRESS", color: "var(--accent-blue)" },
	{ id: "review", label: "REVIEW", color: "var(--text-main)" },
	{ id: "done", label: "DONE", color: "var(--accent-green)" },
];

const archivedColumn = {
	id: "archived",
	label: "ARCHIVED",
	color: "var(--text-subtle)",
};

interface MissionQueueProps {
	selectedTaskId: string | null;
	onSelectTask: (id: string) => void;
}

const MissionQueue: React.FC<MissionQueueProps> = ({
	selectedTaskId,
	onSelectTask,
}) => {
	const [tasks, setTasks] = useState<Task[] | undefined>(undefined);
	const [agents, setAgents] = useState<Agent[] | undefined>(undefined);
	const [autoArchiveEnabled, setAutoArchiveEnabled] = useState(true);
	const [showArchived, setShowArchived] = useState(false);
	const [activeTask, setActiveTask] = useState<Task | null>(null);

	useEffect(() => {
		const load = () =>
			supabase
				.from("mc_tasks")
				.select("*")
				.order("created_at", { ascending: false })
				.then(({ data }) => setTasks(data ?? []));
		load();
		const channel = supabase
			.channel("mq_tasks")
			.on(
				"postgres_changes",
				{ event: "*", schema: "public", table: "mc_tasks" },
				load,
			)
			.subscribe();
		return () => {
			supabase.removeChannel(channel);
		};
	}, []);

	useEffect(() => {
		const load = () =>
			supabase
				.from("mc_agents")
				.select("*")
				.then(({ data }) => setAgents(data ?? []));
		load();
		const channel = supabase
			.channel("mq_agents")
			.on(
				"postgres_changes",
				{ event: "*", schema: "public", table: "mc_agents" },
				load,
			)
			.subscribe();
		return () => {
			supabase.removeChannel(channel);
		};
	}, []);

	useEffect(() => {
		supabase
			.from("mc_settings")
			.select("*")
			.eq("key", "autoArchive24h")
			.maybeSingle()
			.then(({ data }) => {
				if (data !== null) setAutoArchiveEnabled(data.value);
			});
	}, []);

	const setSetting = async (key: string, value: boolean) => {
		await supabase
			.from("mc_settings")
			.upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
		setAutoArchiveEnabled(value);
	};

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 8 },
		}),
	);

	if (tasks === undefined || agents === undefined) {
		return (
			<main className="[grid-area:main] bg-secondary flex flex-col overflow-hidden animate-pulse">
				<div className="h-[65px] bg-white border-b border-border" />
				<div className="flex-1 grid grid-cols-5 gap-px bg-border">
					{[...Array(5)].map((_, i) => (
						<div key={i} className="bg-secondary" />
					))}
				</div>
			</main>
		);
	}

	const currentUserAgent = agents.find((a) => a.name === "Allen");

	const getAgentName = (id: string) => {
		return agents.find((a) => a.id === id)?.name || "Unknown";
	};

	const handleDragStart = (event: DragStartEvent) => {
		const task = tasks.find((t) => t.id === event.active.id);
		if (task) setActiveTask(task);
	};

	const handleDragEnd = async (event: DragEndEvent) => {
		const { active, over } = event;
		setActiveTask(null);

		if (!over || !currentUserAgent) return;

		const taskId = active.id as string;
		const newStatus = over.id as TaskStatus;
		const task = tasks.find((t) => t.id === taskId);

		if (task && task.status !== newStatus) {
			await supabase
				.from("mc_tasks")
				.update({ status: newStatus, updated_at: new Date().toISOString() })
				.eq("id", taskId);

			// Log activity
			await supabase.from("mc_activities").insert({
				type: "status",
				agent_id: currentUserAgent.id,
				message: `moved task to ${newStatus}`,
				target_id: taskId,
			});

			if (newStatus === "in_progress" && task.status !== "in_progress") {
				const message = await buildPrompt(task);
				const assignee = task.assignee_ids.length > 0 ? agents.find((a) => a.id === task.assignee_ids[0]) : null;
				await triggerAgent(taskId, message, assignee?.session_key ?? undefined);
			}
		}
	};

	const handleArchive = async (taskId: string) => {
		if (!currentUserAgent) return;
		await supabase
			.from("mc_tasks")
			.update({ status: "archived", updated_at: new Date().toISOString() })
			.eq("id", taskId);
		await supabase.from("mc_activities").insert({
			type: "status",
			agent_id: currentUserAgent.id,
			message: "archived task",
			target_id: taskId,
		});
	};

	const handleTogglePin = async (taskId: string) => {
		const task = tasks.find((t) => t.id === taskId);
		if (!task) return;
		await supabase
			.from("mc_tasks")
			.update({ pinned: !task.pinned, updated_at: new Date().toISOString() })
			.eq("id", taskId);
	};

	const buildAgentPreamble = (task: Task) => {
		const assignee =
			task.assignee_ids.length > 0
				? agents.find((a) => a.id === task.assignee_ids[0])
				: null;
		if (!assignee) return "";

		const parts: string[] = [];
		if (assignee.system_prompt) parts.push(`System Prompt:\n${assignee.system_prompt}`);
		if (assignee.character) parts.push(`Character:\n${assignee.character}`);
		if (assignee.lore) parts.push(`Lore:\n${assignee.lore}`);

		return parts.length > 0 ? parts.join("\n\n") + "\n\n---\n\n" : "";
	};

	const buildPrompt = async (task: Task) => {
		let prompt = buildAgentPreamble(task);

		prompt +=
			task.description && task.description !== task.title
				? `${task.title}\n\n${task.description}`
				: task.title;

		const { data: messages } = await supabase
			.from("mc_messages")
			.select("*, mc_agents!from_agent_id(name)")
			.eq("task_id", task.id)
			.order("created_at", { ascending: true });

		if (messages && messages.length > 0) {
			const thread = messages
				.map((m: { mc_agents?: { name?: string } | null; content: string }) => `[${m.mc_agents?.name ?? "Agent"}]: ${m.content}`)
				.join("\n\n");
			prompt += `\n\n---\nConversation:\n${thread}\n---\nContinue working on this task based on the conversation above.`;
		}

		return prompt;
	};

	const triggerAgent = async (taskId: string, message: string, group?: string) => {
		try {
			const res = await fetch("/hooks/agent", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					message,
					sessionKey: `mission:${taskId}`,
					group,
				}),
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				console.error(
					"[MissionQueue] BastionClaw IPC error:",
					data.error ?? res.status,
				);
			}
		} catch (err) {
			console.error("[MissionQueue] Failed to trigger bastionclaw agent:", err);
		}
	};

	const handlePlay = async (taskId: string) => {
		if (!currentUserAgent) return;

		await supabase
			.from("mc_tasks")
			.update({ status: "in_progress", updated_at: new Date().toISOString() })
			.eq("id", taskId);

		await supabase.from("mc_activities").insert({
			type: "status",
			agent_id: currentUserAgent.id,
			message: "moved task to in_progress",
			target_id: taskId,
		});

		const task = tasks.find((t) => t.id === taskId);
		if (!task) return;

		const message = await buildPrompt(task);
		const assignee = task.assignee_ids.length > 0 ? agents.find((a) => a.id === task.assignee_ids[0]) : null;
		await triggerAgent(taskId, message, assignee?.session_key ?? undefined);
	};

	const displayColumns = showArchived ? [...columns, archivedColumn] : columns;
	const archivedCount = tasks.filter((t) => t.status === "archived").length;

	return (
		<main className="[grid-area:main] bg-secondary flex flex-col overflow-hidden">
			<div className="flex items-center justify-between px-6 py-5 bg-white border-b border-border">
				<div className="text-[11px] font-bold tracking-widest text-muted-foreground flex items-center gap-2">
					<span className="w-1.5 h-1.5 bg-[var(--accent-orange)] rounded-full" />{" "}
					MISSION QUEUE
				</div>
				<div className="flex gap-2">
					<div className="text-[11px] font-semibold px-3 py-1 rounded bg-muted text-muted-foreground flex items-center gap-1.5">
						<span className="text-sm">📦</span>{" "}
						{tasks.filter((t) => t.status === "inbox").length}
					</div>
					<div className="text-[11px] font-semibold px-3 py-1 rounded bg-[#f0f0f0] text-[#999]">
						{
							tasks.filter(
								(t) => t.status !== "done" && t.status !== "archived",
							).length
						}{" "}
						active
					</div>
					<button
						onClick={() => setShowArchived(!showArchived)}
						className={`text-[11px] font-semibold px-3 py-1 rounded flex items-center gap-1.5 transition-colors ${
							showArchived
								? "bg-[var(--accent-blue)] text-white"
								: "bg-[#f0f0f0] text-[#999] hover:bg-[#e5e5e5]"
						}`}
					>
						<IconArchive size={14} />
						{showArchived ? "Hide Archived" : "Show Archived"}
						{archivedCount > 0 && (
							<span
								className={`px-1.5 rounded-full text-[10px] ${showArchived ? "bg-white/20" : "bg-[#d0d0d0]"}`}
							>
								{archivedCount}
							</span>
						)}
					</button>
				</div>
			</div>

			<DndContext
				sensors={sensors}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
			>
				<div
					className={`flex-1 grid gap-px bg-border overflow-x-auto ${showArchived ? "grid-cols-6" : "grid-cols-5"}`}
				>
					{displayColumns.map((col) => (
						<KanbanColumn
							key={col.id}
							column={col}
							taskCount={tasks.filter((t) => t.status === col.id).length}
							headerExtra={
								col.id === "done" ? (
									<button
										onClick={() =>
											setSetting("autoArchive24h", !autoArchiveEnabled)
										}
										className={`flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded transition-colors ${
											autoArchiveEnabled
												? "bg-green-100 text-green-700"
												: "bg-gray-100 text-gray-400"
										}`}
										title={
											autoArchiveEnabled
												? "Auto-archive after 24h is ON"
												: "Auto-archive after 24h is OFF"
										}
									>
										<IconClock size={10} />
										Auto-Archive (24h)
									</button>
								) : undefined
							}
						>
							{tasks
								.filter((t) => t.status === col.id)
								.sort((a, b) =>
									col.id === "done"
										? (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
										: 0,
								)
								.map((task) => (
									<TaskCard
										key={task.id}
										task={task}
										isSelected={selectedTaskId === task.id}
										onClick={() => onSelectTask(task.id)}
										getAgentName={getAgentName}
										formatRelativeTime={formatRelativeTime}
										columnId={col.id}
										currentUserAgentId={currentUserAgent?.id}
										onArchive={handleArchive}
										onPlay={handlePlay}
										onTogglePin={handleTogglePin}
									/>
								))}
						</KanbanColumn>
					))}
				</div>

				<DragOverlay>
					{activeTask ? (
						<TaskCard
							task={activeTask}
							isSelected={false}
							onClick={() => {}}
							getAgentName={getAgentName}
							formatRelativeTime={formatRelativeTime}
							columnId={activeTask.status}
							isOverlay={true}
						/>
					) : null}
				</DragOverlay>
			</DndContext>
		</main>
	);
};

export default MissionQueue;
