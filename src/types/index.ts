export interface Agent {
	id: string;
	name: string;
	role: string;
	status: "idle" | "active" | "blocked";
	level: "LEAD" | "INT" | "SPC";
	avatar: string;
	current_task_id?: string | null;
	session_key?: string | null;
	system_prompt?: string | null;
	character?: string | null;
	lore?: string | null;
	created_at: string;
	updated_at: string;
}

export interface Task {
	id: string;
	title: string;
	description: string;
	status: "inbox" | "assigned" | "in_progress" | "review" | "done" | "archived";
	assignee_ids: string[];
	tags: string[];
	border_color?: string | null;
	session_key?: string | null;
	run_id?: string | null;
	started_at?: number | null;
	done_at?: number | null;
	used_coding_tools?: boolean;
	source?: string | null;
	pinned: boolean;
	created_at: string;
	updated_at: string;
	// Derived field — not stored in DB, computed by queries
	last_message_time?: number | null;
}

export interface Message {
	id: string;
	task_id: string;
	from_agent_id: string;
	content: string;
	attachments: string[];
	created_at: string;
	// Joined fields
	agent_name?: string;
	agent_avatar?: string;
}

export interface Activity {
	id: string;
	type: string;
	agent_id: string;
	message: string;
	target_id?: string | null;
	created_at: string;
	// Joined
	agent_name?: string;
}

export interface Document {
	id: string;
	title: string;
	content: string;
	type: string;
	path?: string | null;
	task_id?: string | null;
	created_by_agent_id?: string | null;
	message_id?: string | null;
	created_at: string;
	updated_at: string;
	// Joined
	agent_name?: string;
	task_title?: string;
	task_description?: string;
	conversation_messages?: Message[];
}

export interface Setting {
	id: string;
	key: string;
	value: boolean;
	updated_at: string;
}

export interface Notification {
	id: string;
	mentioned_agent_id: string;
	content: string;
	delivered: boolean;
	created_at: string;
}
