import React, { useMemo, useState, useEffect } from "react";
import {
	IconX,
	IconCheck,
	IconUser,
	IconTag,
	IconMessage,
	IconClock,
	IconFileText,
	IconCopy,
	IconCalendar,
	IconArchive,
	IconPlayerPlay,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "../lib/supabase";
import type { Task, Agent, Message, Document, Activity } from "../types";

interface TaskDetailPanelProps {
	taskId: string | null;
	onClose: () => void;
	onPreviewDocument?: (docId: string) => void;
}

const statusColors: Record<string, string> = {
	inbox: "var(--text-subtle)",
	assigned: "var(--accent-orange)",
	in_progress: "var(--accent-blue)",
	review: "var(--text-main)",
	done: "var(--accent-green)",
	archived: "var(--text-subtle)",
};

const statusLabels: Record<string, string> = {
	inbox: "INBOX",
	assigned: "ASSIGNED",
	in_progress: "IN PROGRESS",
	review: "REVIEW",
	done: "DONE",
	archived: "ARCHIVED",
};

const TaskDetailPanel: React.FC<TaskDetailPanelProps> = ({
	taskId,
	onClose,
	onPreviewDocument,
}) => {
	const [tasks, setTasks] = useState<Task[]>([]);
	const [agents, setAgents] = useState<Agent[]>([]);
	const [resources, setResources] = useState<Document[]>([]);
	const [activities, setActivities] = useState<Activity[]>([]);
	const [messages, setMessages] = useState<Message[]>([]);

	const [description, setDescription] = useState("");
	const [isEditingDesc, setIsEditingDesc] = useState(false);
	const [commentText, setCommentText] = useState("");
	const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
	const [isAddingDoc, setIsAddingDoc] = useState(false);
	const [newDocTitle, setNewDocTitle] = useState("");
	const [newDocType, setNewDocType] = useState("note");
	const [newDocPath, setNewDocPath] = useState("");
	const [newDocContent, setNewDocContent] = useState("");

	useEffect(() => {
		const load = () =>
			supabase
				.from("mc_tasks")
				.select("*")
				.then(({ data }) => setTasks(data ?? []));
		load();
		const ch = supabase
			.channel("tdp_tasks")
			.on("postgres_changes", { event: "*", schema: "public", table: "mc_tasks" }, load)
			.subscribe();
		return () => { supabase.removeChannel(ch); };
	}, []);

	useEffect(() => {
		const load = () =>
			supabase
				.from("mc_agents")
				.select("*")
				.then(({ data }) => setAgents(data ?? []));
		load();
		const ch = supabase
			.channel("tdp_agents")
			.on("postgres_changes", { event: "*", schema: "public", table: "mc_agents" }, load)
			.subscribe();
		return () => { supabase.removeChannel(ch); };
	}, []);

	useEffect(() => {
		if (!taskId) return;
		const load = () =>
			supabase
				.from("mc_documents")
				.select("*, mc_agents!created_by_agent_id(name)")
				.eq("task_id", taskId)
				.then(({ data }) => setResources((data ?? []).map((d: Record<string, unknown>) => ({
					...(d as unknown as Document),
					agent_name: (d.mc_agents as { name?: string } | null)?.name,
				}))));
		load();
		const ch = supabase
			.channel(`tdp_docs_${taskId}`)
			.on("postgres_changes", { event: "*", schema: "public", table: "mc_documents" }, load)
			.subscribe();
		return () => { supabase.removeChannel(ch); };
	}, [taskId]);

	useEffect(() => {
		if (!taskId) return;
		const load = () =>
			supabase
				.from("mc_activities")
				.select("*, mc_agents!agent_id(name)")
				.eq("target_id", taskId)
				.order("created_at", { ascending: false })
				.limit(50)
				.then(({ data }) => setActivities((data ?? []).map((a: Record<string, unknown>) => ({
					...(a as unknown as Activity),
					agent_name: (a.mc_agents as { name?: string } | null)?.name,
				}))));
		load();
		const ch = supabase
			.channel(`tdp_activities_${taskId}`)
			.on("postgres_changes", { event: "*", schema: "public", table: "mc_activities" }, load)
			.subscribe();
		return () => { supabase.removeChannel(ch); };
	}, [taskId]);

	useEffect(() => {
		if (!taskId) return;
		const load = () =>
			supabase
				.from("mc_messages")
				.select("*, mc_agents!from_agent_id(name, avatar)")
				.eq("task_id", taskId)
				.order("created_at", { ascending: true })
				.then(({ data }) => setMessages((data ?? []).map((m: Record<string, unknown>) => ({
					...(m as unknown as Message),
					agent_name: (m.mc_agents as { name?: string; avatar?: string } | null)?.name,
					agent_avatar: (m.mc_agents as { name?: string; avatar?: string } | null)?.avatar,
				}))));
		load();
		const ch = supabase
			.channel(`tdp_messages_${taskId}`)
			.on("postgres_changes", { event: "*", schema: "public", table: "mc_messages" }, load)
			.subscribe();
		return () => { supabase.removeChannel(ch); };
	}, [taskId]);

	const task = tasks.find((t) => t.id === taskId);
	const systemAgent = agents.find((a) => a.role === "AI Assistant") ?? agents[0] ?? null;

	useEffect(() => {
		if (task) setDescription(task.description);
	}, [task]);

	// These must be before any conditional returns to satisfy Rules of Hooks
	const docsById = useMemo(() => {
		const map = new Map<string, Document>();
		resources.forEach((doc) => map.set(doc.id, doc));
		return map;
	}, [resources]);

	const sortedMessages = useMemo(() => [...messages], [messages]);

	if (!taskId) return null;
	if (!task) return null;

	const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
		if (!systemAgent) return;
		const newStatus = e.target.value as Task["status"];
		await supabase
			.from("mc_tasks")
			.update({ status: newStatus, updated_at: new Date().toISOString() })
			.eq("id", task.id);
		await supabase.from("mc_activities").insert({
			type: "status",
			agent_id: systemAgent.id,
			message: `changed status to ${newStatus}`,
			target_id: task.id,
		});
	};

	const handleAssigneeToggle = async (agentId: string) => {
		if (!systemAgent) return;
		const currentAssignees = task.assignee_ids || [];
		const isAssigned = currentAssignees.includes(agentId);
		const newAssignees = isAssigned
			? currentAssignees.filter((id) => id !== agentId)
			: [...currentAssignees, agentId];
		await supabase
			.from("mc_tasks")
			.update({ assignee_ids: newAssignees, updated_at: new Date().toISOString() })
			.eq("id", task.id);
	};

	const saveDescription = async () => {
		if (!systemAgent) return;
		await supabase
			.from("mc_tasks")
			.update({ description, updated_at: new Date().toISOString() })
			.eq("id", task.id);
		await supabase.from("mc_activities").insert({
			type: "update",
			agent_id: systemAgent.id,
			message: "updated task description",
			target_id: task.id,
		});
		setIsEditingDesc(false);
	};

	const toggleAttachment = (docId: string) => {
		setSelectedAttachmentIds((prev) =>
			prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId],
		);
	};

	const sendComment = async () => {
		if (!systemAgent) return;
		const trimmed = commentText.trim();
		if (!trimmed) return;
		await supabase.from("mc_messages").insert({
			task_id: task.id,
			from_agent_id: systemAgent.id,
			content: trimmed,
			attachments: selectedAttachmentIds,
		});
		await supabase.from("mc_activities").insert({
			type: "comments",
			agent_id: systemAgent.id,
			message: "added a comment",
			target_id: task.id,
		});
		setCommentText("");
		setSelectedAttachmentIds([]);
	};

	const buildAgentPreamble = () => {
		if (!task || !agents) return "";
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

	const handleResume = async () => {
		if (!systemAgent || !task) return;

		const trimmed = commentText.trim();
		if (trimmed) {
			await supabase.from("mc_messages").insert({
				task_id: task.id,
				from_agent_id: systemAgent.id,
				content: trimmed,
				attachments: selectedAttachmentIds,
			});
			setCommentText("");
			setSelectedAttachmentIds([]);
		}

		await supabase
			.from("mc_tasks")
			.update({ status: "in_progress", updated_at: new Date().toISOString() })
			.eq("id", task.id);

		await supabase.from("mc_activities").insert({
			type: "status",
			agent_id: systemAgent.id,
			message: "resumed task",
			target_id: task.id,
		});

		let prompt = buildAgentPreamble();
		prompt +=
			task.description && task.description !== task.title
				? `${task.title}\n\n${task.description}`
				: task.title;

		const allMessages = [...sortedMessages];
		if (trimmed) {
			allMessages.push({
				id: "",
				task_id: task.id,
				from_agent_id: systemAgent.id,
				content: trimmed,
				attachments: [],
				created_at: new Date().toISOString(),
				agent_name: systemAgent.name,
			});
		}

		if (allMessages.length > 0) {
			const thread = allMessages
				.map((m) => `[${m.agent_name ?? "Agent"}]: ${m.content}`)
				.join("\n\n");
			prompt += `\n\n---\nConversation:\n${thread}\n---\nContinue working on this task based on the conversation above.`;
		}

		try {
			const assignee = task.assignee_ids.length > 0
				? agents.find((a) => a.id === task.assignee_ids[0])
				: null;
			const res = await fetch("/hooks/agent", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					message: prompt,
					sessionKey: `mission:${task.id}`,
					group: assignee?.session_key ?? undefined,
				}),
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				console.error("[TaskDetailPanel] BastionClaw IPC error:", data.error ?? res.status);
			}
		} catch (err) {
			console.error("[TaskDetailPanel] Failed to trigger bastionclaw agent:", err);
		}
	};

	const resetNewDocForm = () => {
		setNewDocTitle("");
		setNewDocType("note");
		setNewDocPath("");
		setNewDocContent("");
	};

	const submitNewDoc = async () => {
		if (!systemAgent) return;
		const trimmedTitle = newDocTitle.trim();
		if (!trimmedTitle) return;
		const { data: newDoc } = await supabase
			.from("mc_documents")
			.insert({
				title: trimmedTitle,
				type: newDocType.trim() || "note",
				content: newDocContent.trim(),
				path: newDocPath.trim() || null,
				task_id: task.id,
				created_by_agent_id: systemAgent.id,
			})
			.select()
			.single();
		if (newDoc) {
			setSelectedAttachmentIds((prev) => [...prev, newDoc.id]);
		}
		resetNewDocForm();
		setIsAddingDoc(false);
	};

	const renderAvatar = (avatar?: string) => {
		if (!avatar) return <IconUser size={10} />;
		const isUrl = avatar.startsWith("http") || avatar.startsWith("data:");
		if (isUrl) {
			return (
				<img src={avatar} className="w-full h-full object-cover" alt="avatar" />
			);
		}
		return (
			<span className="text-[10px] flex items-center justify-center h-full w-full leading-none">
				{avatar}
			</span>
		);
	};

	const formatCreationDate = (isoString: string) => {
		return new Date(isoString).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	const lastUpdatedActivity = activities[0];
	const lastUpdated = lastUpdatedActivity ? lastUpdatedActivity.created_at : null;

	return (
		<div className="fixed inset-y-0 right-0 w-[380px] bg-white border-l border-border shadow-xl transform transition-transform duration-300 ease-in-out flex flex-col z-50">
			{/* Header */}
			<div className="flex items-center justify-between px-5 py-3 border-b border-border bg-[#f8f9fa]">
				<div className="flex items-center gap-2">
					<span
						className="w-2 h-2 rounded-full"
						style={{ backgroundColor: statusColors[task.status] || "gray" }}
					/>
					<span className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
						{task.id.slice(-6)}
					</span>
				</div>
				<button
					onClick={onClose}
					className="p-1 hover:bg-muted rounded text-muted-foreground transition-colors"
				>
					<IconX size={18} />
				</button>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
				{/* Title */}
				<div>
					<h2 className="text-lg font-bold text-foreground leading-tight mb-1.5">
						{task.title}
					</h2>
					<div className="flex gap-2 mb-3">
						{task.tags.map((tag) => (
							<span
								key={tag}
								className="text-[10px] px-2 py-0.5 bg-muted rounded font-medium text-muted-foreground flex items-center gap-1"
							>
								<IconTag size={10} /> {tag}
							</span>
						))}
					</div>

					{/* Quick Actions */}
					<div className="flex gap-2">
						{task.status !== "done" && task.status !== "archived" && (
							<button
								onClick={() =>
									supabase
										.from("mc_tasks")
										.update({ status: "done", updated_at: new Date().toISOString() })
										.eq("id", task.id)
										.then(() =>
											systemAgent && supabase.from("mc_activities").insert({
												type: "status",
												agent_id: systemAgent.id,
												message: "marked task as done",
												target_id: task.id,
											}),
										)
								}
								className="flex-1 py-1.5 bg-[var(--accent-green)] text-white rounded text-xs font-medium flex items-center justify-center gap-2 transition-opacity shadow-sm hover:opacity-90"
							>
								<IconCheck size={16} />
								Mark as Done
							</button>
						)}
						{task.status !== "archived" && (
							<button
								onClick={() =>
									supabase
										.from("mc_tasks")
										.update({ status: "archived", updated_at: new Date().toISOString() })
										.eq("id", task.id)
								}
								className={`${task.status === "done" ? "flex-1" : ""} py-1.5 px-3 bg-muted text-muted-foreground rounded text-xs font-medium flex items-center justify-center gap-2 transition-colors shadow-sm hover:bg-[#e5e5e5]`}
							>
								<IconArchive size={16} />
								Archive
							</button>
						)}
					</div>
				</div>

				{/* Status */}
				<div className="space-y-1">
					<label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
						Status
					</label>
					<select
						value={task.status}
						onChange={handleStatusChange}
						className="w-full p-1.5 text-sm border border-border rounded bg-secondary text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
					>
						{Object.entries(statusLabels).map(([key, label]) => (
							<option key={key} value={key}>
								{label}
							</option>
						))}
					</select>
				</div>

				{/* Description */}
				<div className="space-y-1 group">
					<div className="flex items-center justify-between">
						<label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
							Description
						</label>
						{!isEditingDesc && (
							<button
								onClick={() => setIsEditingDesc(true)}
								className="text-[10px] text-[var(--accent-blue)] opacity-0 group-hover:opacity-100 transition-opacity"
							>
								Edit
							</button>
						)}
					</div>

					{isEditingDesc ? (
						<div className="flex flex-col gap-2">
							<textarea
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								className="w-full min-h-[90px] p-2.5 text-sm border border-border rounded bg-white text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
							/>
							<div className="flex justify-end gap-2">
								<button
									onClick={() => setIsEditingDesc(false)}
									className="px-3 py-1 text-xs text-muted-foreground hover:bg-muted rounded"
								>
									Cancel
								</button>
								<button
									onClick={saveDescription}
									className="px-3 py-1 text-xs bg-foreground text-secondary rounded hover:opacity-90"
								>
									Save
								</button>
							</div>
						</div>
					) : (
						<p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
							{task.description}
						</p>
					)}
				</div>

				{/* Assignees */}
				<div className="space-y-2">
					<label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
						Assignees
					</label>
					<div className="flex flex-wrap gap-1.5">
						{task.assignee_ids?.map((id) => {
							const agent = agents.find((a) => a.id === id);
							return (
								<div
									key={id}
									className="flex items-center gap-1.5 px-2 py-1 bg-white border border-border rounded-full shadow-sm"
								>
									<div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center overflow-hidden">
										{renderAvatar(agent?.avatar)}
									</div>
									<span className="text-xs font-medium text-foreground">
										{agent?.name || "Unknown"}
									</span>
									<button
										onClick={() => handleAssigneeToggle(id)}
										className="hover:text-red-500"
									>
										<IconX size={12} />
									</button>
								</div>
							);
						})}
						<div className="relative group">
							<button
								className="flex items-center gap-1 px-2 py-1 bg-muted border border-transparent rounded-full text-[11px] text-muted-foreground hover:bg-white hover:border-border transition-all"
							>
								<span>+ Add</span>
							</button>
							<div className="absolute top-full left-0 mt-1 w-48 bg-white border border-border shadow-lg rounded-lg hidden group-hover:block z-10 p-1">
								{agents
									.filter((a) => !task.assignee_ids?.includes(a.id))
									.map((agent) => (
										<button
											key={agent.id}
											onClick={() => handleAssigneeToggle(agent.id)}
											className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted rounded flex items-center gap-2"
										>
											<div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center overflow-hidden">
												{renderAvatar(agent.avatar)}
											</div>
											{agent.name}
										</button>
									))}
								{agents.filter((a) => !task.assignee_ids?.includes(a.id))
									.length === 0 && (
									<div className="px-2 py-1.5 text-xs text-muted-foreground text-center">
										No available agents
									</div>
								)}
							</div>
						</div>
					</div>
				</div>

				{/* Resources / Deliverables */}
				{resources.length > 0 && (
					<div className="space-y-2">
						<label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
							Resources / Deliverables
						</label>
						<div className="space-y-1">
							{resources.map((doc) => (
								<div
									key={doc.id}
									onClick={() => onPreviewDocument?.(doc.id)}
									className="flex items-center justify-between p-1.5 bg-white border border-border rounded text-sm hover:bg-muted transition-colors cursor-pointer"
								>
									<div className="flex items-center gap-2 overflow-hidden">
										<IconFileText
											size={14}
											className="text-muted-foreground shrink-0"
										/>
										<div className="flex flex-col min-w-0">
											<span className="truncate text-foreground font-medium">
												{doc.title}
											</span>
											{doc.path && (
												<span className="text-[10px] text-muted-foreground truncate font-mono">
													{doc.path}
												</span>
											)}
										</div>
									</div>
									<span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground uppercase self-start mt-0.5">
										{doc.type}
									</span>
								</div>
							))}
						</div>
					</div>
				)}

				{/* Comments */}
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
							Comments
						</label>
						<button
							onClick={() => setIsAddingDoc((prev) => !prev)}
							className="text-[10px] text-[var(--accent-blue)]"
						>
							{isAddingDoc ? "Close Resource" : "Add Resource"}
						</button>
					</div>

					{sortedMessages.length === 0 && (
						<div className="text-xs text-muted-foreground bg-muted/40 border border-border rounded p-3">
							No comments yet. Start the conversation.
						</div>
					)}

					{sortedMessages.length > 0 && (
						<div className="space-y-2.5">
							{sortedMessages.map((msg) => (
								<div
									key={msg.id}
									className="flex gap-2 p-2.5 bg-white border border-border rounded"
								>
									<div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
										{renderAvatar(msg.agent_avatar)}
									</div>
									<div className="flex-1 min-w-0 space-y-1">
										<div className="flex items-center justify-between text-[11px] text-muted-foreground">
											<span className="font-semibold text-foreground">
												{msg.agent_name}
											</span>
											<span className="shrink-0 ml-2">
												{formatCreationDate(msg.created_at)}
											</span>
										</div>
										<div className="text-sm text-foreground markdown-content overflow-hidden break-words">
											<ReactMarkdown>{msg.content}</ReactMarkdown>
										</div>
										{msg.attachments?.length > 0 && (
											<div className="flex flex-wrap gap-1.5 pt-1">
												{msg.attachments.map((attachmentId) => {
													const doc = docsById.get(attachmentId);
													return (
														<div
															key={attachmentId}
															onClick={() =>
																doc && onPreviewDocument?.(doc.id)
															}
															className="text-[10px] px-2 py-0.5 bg-muted rounded border border-border text-muted-foreground flex items-center gap-1 cursor-pointer hover:bg-[var(--accent-blue)]/10 hover:border-[var(--accent-blue)]/30 transition-colors"
														>
															<IconFileText size={10} />
															<span className="font-medium">
																{doc?.title || "Attachment"}
															</span>
															{doc?.path && (
																<span className="text-[9px] text-muted-foreground font-mono truncate max-w-[120px]">
																	{doc.path}
																</span>
															)}
														</div>
													);
												})}
											</div>
										)}
									</div>
								</div>
							))}
						</div>
					)}

					{/* Attach existing resources */}
					{resources.length > 0 && (
						<div className="flex flex-wrap gap-1.5 pt-1">
							{resources.map((doc) => {
								const isSelected = selectedAttachmentIds.includes(doc.id);
								return (
									<button
										key={doc.id}
										onClick={() => toggleAttachment(doc.id)}
										className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
											isSelected
												? "bg-[var(--accent-blue)] text-white border-[var(--accent-blue)]"
												: "bg-white text-muted-foreground border-border hover:bg-muted"
										}`}
									>
										{doc.title}
									</button>
								);
							})}
						</div>
					)}

					{selectedAttachmentIds.length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{selectedAttachmentIds.map((id) => {
								const doc = docsById.get(id);
								return (
									<div
										key={id}
										className="text-[10px] px-2 py-0.5 bg-secondary rounded text-muted-foreground flex items-center gap-1"
									>
										<IconFileText size={10} />
										<span className="font-medium">
											{doc?.title || "Attachment"}
										</span>
										<button
											onClick={() => toggleAttachment(id)}
											className="hover:text-foreground"
											title="Remove attachment"
										>
											<IconX size={10} />
										</button>
									</div>
								);
							})}
						</div>
					)}

					{isAddingDoc && (
						<div className="space-y-2 p-2.5 bg-muted/40 border border-border rounded">
							<div className="flex flex-col gap-2">
								<input
									value={newDocTitle}
									onChange={(e) => setNewDocTitle(e.target.value)}
									placeholder="Document title"
									className="w-full p-2 text-xs border border-border rounded bg-white text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
								/>
								<div className="flex gap-2">
									<input
										value={newDocType}
										onChange={(e) => setNewDocType(e.target.value)}
										placeholder="Type (note, spec, link)"
										className="flex-1 p-2 text-xs border border-border rounded bg-white text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
									/>
									<input
										value={newDocPath}
										onChange={(e) => setNewDocPath(e.target.value)}
										placeholder="Path (optional)"
										className="flex-1 p-2 text-xs border border-border rounded bg-white text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
									/>
								</div>
								<textarea
									value={newDocContent}
									onChange={(e) => setNewDocContent(e.target.value)}
									placeholder="Content (optional)"
									className="w-full min-h-[70px] p-2 text-xs border border-border rounded bg-white text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
								/>
								<div className="flex justify-end gap-2">
									<button
										onClick={() => {
											resetNewDocForm();
											setIsAddingDoc(false);
										}}
										className="px-3 py-1 text-[10px] text-muted-foreground hover:bg-muted rounded"
									>
										Cancel
									</button>
									<button
										onClick={submitNewDoc}
										disabled={!newDocTitle.trim()}
										className="px-3 py-1 text-[10px] bg-foreground text-secondary rounded hover:opacity-90 disabled:opacity-50"
									>
										Add Resource
									</button>
								</div>
							</div>
						</div>
					)}

					<div className="space-y-2">
						<textarea
							value={commentText}
							onChange={(e) => setCommentText(e.target.value)}
							placeholder="Write a comment..."
							className="w-full min-h-[80px] p-2.5 text-sm border border-border rounded bg-white text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
						/>
						<div className="flex justify-end gap-2">
							<button
								onClick={sendComment}
								disabled={commentText.trim().length === 0}
								className="px-4 py-2 text-xs bg-[var(--accent-blue)] text-white rounded font-semibold hover:opacity-90 disabled:opacity-50"
							>
								Send Comment
							</button>
							{task.status === "review" && (
								<button
									onClick={handleResume}
									className="px-4 py-2 text-xs bg-[var(--accent-green)] text-white rounded font-semibold hover:opacity-90 flex items-center gap-1.5"
								>
									<IconPlayerPlay size={14} />
									Resume
								</button>
							)}
						</div>
					</div>
				</div>

				{/* Meta */}
				<div className="mt-auto pt-6 border-t border-border flex flex-col gap-2">
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<div className="flex items-center gap-2">
							<IconClock size={12} />
							<span>Created {formatCreationDate(task.created_at)}</span>
						</div>
						{lastUpdated && (
							<div className="flex items-center gap-2">
								<IconCalendar size={12} />
								<span>Updated {formatCreationDate(lastUpdated)}</span>
							</div>
						)}
					</div>
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<div className="flex items-center gap-2">
							<IconMessage size={12} />
							<span>{messages.length} comments</span>
						</div>
						<div
							className="flex items-center gap-2 cursor-pointer hover:text-foreground transition-colors"
							onClick={() => {
								navigator.clipboard.writeText(task.id);
							}}
							title="Copy Task ID"
						>
							<span>ID: {task.id.slice(-6)}</span>
							<IconCopy size={12} />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

export default TaskDetailPanel;
