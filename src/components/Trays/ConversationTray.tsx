import React, { useState, useEffect } from "react";
import Markdown from "react-markdown";
import { supabase } from "../../lib/supabase";
import type { Document, Message } from "../../types";

type DocumentContext = Document & {
	task_title?: string;
	task_description?: string;
	conversation_messages: Message[];
};

type ConversationTrayProps = {
	documentId: string;
	onClose: () => void;
	onOpenPreview: () => void;
};

const ConversationTray: React.FC<ConversationTrayProps> = ({
	documentId,
	onClose,
	onOpenPreview,
}) => {
	const [documentContext, setDocumentContext] = useState<DocumentContext | null>(null);

	useEffect(() => {
		const load = async () => {
			const { data: doc } = await supabase
				.from("mc_documents")
				.select("*, mc_agents!created_by_agent_id(name)")
				.eq("id", documentId)
				.maybeSingle();

			if (!doc) return;

			const agentName = (doc.mc_agents as { name?: string } | null)?.name;

			let taskTitle: string | undefined;
			let taskDescription: string | undefined;
			if (doc.task_id) {
				const { data: task } = await supabase
					.from("mc_tasks")
					.select("title, description")
					.eq("id", doc.task_id)
					.maybeSingle();
				taskTitle = task?.title;
				taskDescription = task?.description;
			}

			let conversationMessages: Message[] = [];
			if (doc.task_id) {
				const { data: msgs } = await supabase
					.from("mc_messages")
					.select("*, mc_agents!from_agent_id(name, avatar)")
					.eq("task_id", doc.task_id)
					.order("created_at", { ascending: true });
				if (msgs) {
					conversationMessages = msgs.map((m: Record<string, unknown>) => ({
						...(m as Message),
						agent_name: (m.mc_agents as { name?: string; avatar?: string } | null)?.name,
						agent_avatar: (m.mc_agents as { name?: string; avatar?: string } | null)?.avatar,
					}));
				}
			}

			setDocumentContext({
				...(doc as Document),
				agent_name: agentName,
				task_title: taskTitle,
				task_description: taskDescription,
				conversation_messages: conversationMessages,
			});
		};

		load();

		const ch = supabase
			.channel(`conv_tray_${documentId}`)
			.on("postgres_changes", { event: "*", schema: "public", table: "mc_messages" }, load)
			.on("postgres_changes", { event: "*", schema: "public", table: "mc_documents" }, load)
			.subscribe();

		return () => { supabase.removeChannel(ch); };
	}, [documentId]);

	if (!documentContext) {
		return (
			<div className="tray is-open">
				<div className="p-4 animate-pulse">
					<div className="h-8 bg-muted rounded mb-4" />
					<div className="space-y-3">
						{[...Array(4)].map((_, i) => (
							<div key={i} className="h-16 bg-muted rounded" />
						))}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="tray is-open">
			<div className="flex flex-col h-full">
				{/* Header */}
				<div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={onClose}
							className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground"
							aria-label="Close conversation tray"
						>
							✕
						</button>
						<span className="text-[11px] font-bold tracking-widest text-muted-foreground">
							CONTEXT
						</span>
					</div>
					<button
						type="button"
						onClick={onOpenPreview}
						className="text-[10px] font-semibold px-3 py-1.5 rounded bg-[var(--accent-orange)] text-white hover:bg-[var(--accent-orange)]/90 transition-colors"
					>
						Open Preview
					</button>
				</div>

				{/* Document info */}
				<div className="px-4 py-3 border-b border-border bg-muted/30">
					<h3 className="text-sm font-semibold text-foreground truncate">
						{documentContext.title}
					</h3>
					<div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
						{documentContext.agent_name && (
							<>
								<span className="text-[var(--accent-orange)] font-medium">
									{documentContext.agent_name}
								</span>
								<span>·</span>
							</>
						)}
						<span className="capitalize">{documentContext.type}</span>
						{documentContext.task_title && (
							<>
								<span>·</span>
								<span className="truncate">
									Task: {documentContext.task_title}
								</span>
							</>
						)}
					</div>
				</div>

				{/* Full conversation thread */}
				<div className="flex-1 overflow-y-auto p-4">
					<div className="flex flex-col gap-3">
						{/* Original prompt */}
						{documentContext.task_description && (
							<>
								<div className="text-[10px] font-bold tracking-widest text-muted-foreground mb-1">
									PROMPT
								</div>
								<div className="p-3 bg-blue-50 border border-blue-200 rounded-lg mb-2">
									<div className="flex items-center gap-2 mb-1.5">
										<span className="text-lg">👤</span>
										<span className="text-xs font-semibold text-blue-700">
											User
										</span>
									</div>
									<div className="text-xs text-foreground leading-relaxed markdown-content">
										<Markdown>{documentContext.task_description}</Markdown>
									</div>
								</div>
							</>
						)}

						{/* Message thread */}
						{documentContext.conversation_messages.length > 0 && (
							<>
								<div className="text-[10px] font-bold tracking-widest text-muted-foreground mb-1">
									AGENT THREAD
								</div>
								{documentContext.conversation_messages.map((msg) => (
									<div
										key={msg.id}
										className="p-3 bg-secondary border border-border rounded-lg"
									>
										<div className="flex items-center gap-2 mb-1.5">
											{msg.agent_avatar && (
												<span className="text-lg">{msg.agent_avatar}</span>
											)}
											<span className="text-xs font-semibold text-[var(--accent-orange)]">
												{msg.agent_name}
											</span>
										</div>
										<div className="text-xs text-foreground leading-relaxed markdown-content">
											<Markdown>{msg.content}</Markdown>
										</div>
									</div>
								))}
							</>
						)}

						{/* No content message */}
						{!documentContext.task_description &&
							documentContext.conversation_messages.length === 0 && (
								<div className="text-center py-8">
									<div className="text-muted-foreground text-sm">
										No conversation history available
									</div>
									<div className="text-muted-foreground/60 text-xs mt-1">
										This document was created without task context
									</div>
								</div>
							)}
					</div>
				</div>
			</div>
		</div>
	);
};

export default ConversationTray;
