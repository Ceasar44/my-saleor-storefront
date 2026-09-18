import { createAgentPost } from "@/agent/agui/server";
import { prepareAdapterRequest } from "@/agent/agui/adapter-auth";

export const runtime = "nodejs";
export const POST = createAgentPost({ prepare: prepareAdapterRequest });
