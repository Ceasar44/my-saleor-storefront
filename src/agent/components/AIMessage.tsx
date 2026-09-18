"use client";
import Markdown from "react-markdown";
import type { AgentChatMessage } from "@/agent/components/AIProvider";
export function AIMessage({ message }: { message: AgentChatMessage }) {
	return (
		<div
			className={
				message.role === "user" ? "ml-6 rounded-lg bg-muted p-3 text-sm" : "mr-2 break-words text-sm"
			}
			aria-busy={message.streaming}
		>
			{message.role === "assistant" ? (
				<Markdown
					skipHtml
					components={{
						a: ({ children, href }) => (
							<a className="underline" href={href} target="_blank" rel="noopener noreferrer">
								{children}
							</a>
						),
						p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
					}}
				>
					{message.content}
				</Markdown>
			) : (
				<p className="whitespace-pre-wrap">{message.content}</p>
			)}
		</div>
	);
}
