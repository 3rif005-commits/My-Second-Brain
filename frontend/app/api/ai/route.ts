/* eslint-disable @typescript-eslint/no-explicit-any */
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, convertToCoreMessages } from "ai";
import { createClient } from "@/lib/supabase/server";

// Dynamic import for @blocknote/xl-ai/server — the package is in
// serverExternalPackages so Node.js loads its ESM build natively.
// The type declarations in server.d.ts are empty in 0.48, hence `as any`.
async function getXlAIServer() {
  return (await import("@blocknote/xl-ai/server")) as any;
}

// POST /api/ai — BlockNote's editor AI.
//
// This used to call Gemini directly from Next.js with its own API key, which
// made the editor the one surface whose spend no run row saw, no budget capped
// and no provider setting governed. It now points the same AI SDK at the
// backend's own OpenAI-compatible endpoint (POST /v1/chat/completions), so the
// request takes the same provider chain, run log and ceiling as everything
// else — and the client keeps the wire format it already parses.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const fastApiUrl = process.env.FASTAPI_URL ?? "http://localhost:8000";
  const gateway = createOpenAI({
    baseURL: `${fastApiUrl}/v1`,
    // The backend authenticates the user and picks the provider; the key here
    // is the session, not a model vendor's.
    apiKey: session.access_token,
  });

  const { aiDocumentFormats, injectDocumentStateMessages, toolDefinitionsToToolSet } =
    await getXlAIServer();

  const { messages, toolDefinitions } = await req.json();

  // The model name is decided by the backend's provider chain; this string is
  // only what the SDK needs to build a request.
  const result = streamText({
    model: gateway("configured") as any,
    system: aiDocumentFormats.html.systemPrompt,
    messages: convertToCoreMessages(injectDocumentStateMessages(messages) as any),
    tools: toolDefinitionsToToolSet(toolDefinitions),
    toolChoice: "required",
    maxSteps: 10,
  });

  return result.toDataStreamResponse();
}
