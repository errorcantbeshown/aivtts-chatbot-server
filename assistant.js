import OpenAI from 'openai';
import { storeUserMemory } from './memory.js';
import crypto from 'crypto';

/**
 * Embeddings: unchanged, still uses text-embedding-3-large.
 */
export async function getEmbedding(openaiAPIKey, text) {
    const openai = new OpenAI({
        apiKey: openaiAPIKey,
    });

    const res = await openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: text,
        encoding_format: 'float',
    });
    return res.data[0].embedding;
}

/**
 * ---- Conversation state (persistent threads) ----
 *
 * This simple in-memory store maps thread_id -> array of { role, content }.
 * Swap this out for Redis/DB if you need true persistence.
 */
const threadStore = new Map(); // Map<string, Array<{role: "user"|"assistant"|"system", content: string}>>

function createNewThreadId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getOrCreateThread(thread_id) {
    let id = thread_id;
    if (!id) {
        id = createNewThreadId();
        console.log('No Thread ID specified, creating new Thread...', id);
    } else {
        console.log('Current Thread ID:', id);
    }

    if (!threadStore.has(id)) {
        threadStore.set(id, []);
    }
    return { id, messages: threadStore.get(id) };
}

/**
 * ---- Tools definition (function calling) ----
 *
 * This mirrors your original Assistant tool JSON exactly.
 *
 * {
 *   "name": "storeUserMemory",
 *   "description": "Store a memory about a specific Twitch user",
 *   "strict": true,
 *   "parameters": { ... }
 * }
 */
const TOOLS = [
    {
        type: 'function',
        name: 'storeUserMemory',
        description: 'Store a memory about a specific Twitch user',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                username: {
                    type: 'string',
                    description: 'The Twitch username of the viewer',
                },
                memory: {
                    type: 'string',
                    description: 'The memory to store about the viewer',
                },
            },
            additionalProperties: false,
            required: ['username', 'memory'],
        },
    },
];

/**
 * Main helper: generate a reply using the Responses API + tools.
 *
 * Signature:
 *   getReplyFromAssistant({
 *     openaiAPIKey,
 *     model,          // e.g. "gpt-4o"
 *     thread_id,      // optional, for persistent conversation
 *     messageContent, // user message (string)
 *     systemPrompt,   // optional system-level instructions
 *     username,       // default username, used if tool omits it
 *   })
 *
 * Returns:
 *   { thread_id, reply }
 */
export async function getReplyFromAssistant({
    openaiAPIKey,
    model = 'gpt-4o',
    thread_id,
    messageContent,
    systemPrompt = process.env.DEFAULT_SYSTEM_PROMPT || 'You are a helpful assistant.',
    username = null,
}) {
    const openai = new OpenAI({ apiKey: openaiAPIKey });

    const { id: effectiveThreadId, messages } = getOrCreateThread(thread_id);

    // Append the new user message to our own conversation history
    messages.push({ role: 'user', content: messageContent });

    // Build the base conversation for the model
    const inputMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    try {
        // 1) First call: let the model either answer directly or emit function calls
        let response = await openai.responses.create({
            model,
            input: inputMessages,
            tools: TOOLS,
            // tool_choice: "auto" by default
        });

        // Base payload for next step: prior dialog + whatever the model just produced
        let conversationPayload = [...inputMessages];
        if (Array.isArray(response.output)) {
            conversationPayload = conversationPayload.concat(response.output);
        }

        // Find any function calls (Responses API pattern: type === "function_call") 
        const toolCalls = (response.output || []).filter(
            (item) => item.type === 'function_call' && item.name === 'storeUserMemory'
        );

        if (toolCalls.length > 0) {
            for (const call of toolCalls) {
                const argStr = call.arguments || '{}';

                let args = {};
                try {
                    args = JSON.parse(argStr);
                } catch (e) {
                    console.error('Failed to parse storeUserMemory args:', e, argStr);
                    continue;
                }

                const targetUsername = args.username || username;
                const memory = args.memory;

                if (!targetUsername || !memory) {
                    console.warn(
                        'storeUserMemory called without username or memory:',
                        args
                    );
                    continue;
                }

                // Execute your actual JS function
                try {
                    await storeUserMemory(openaiAPIKey, targetUsername, memory);
                } catch (memErr) {
                    console.error('Error running storeUserMemory:', memErr);
                }

                // Attach function output back into the conversation per function-calling docs:
                //   { type: "function_call_output", call_id, output } 
                const callId = call.call_id || `storeUserMemory-${Date.now()}`;

                conversationPayload.push({
                    type: 'function_call_output',
                    call_id: callId,
                    output: 'Memory stored!',
                });
            }

            // 2) Second call: after tools have run, request final user-facing answer
            const finalResponse = await openai.responses.create({
                model,
                input: conversationPayload,
                tools: TOOLS,
            });

            const replyText = finalResponse.output_text || '';

            // Persist assistant reply in our thread history
            messages.push({ role: 'assistant', content: replyText });

            return {
                thread_id: effectiveThreadId,
                reply: replyText,
            };
        }

        // No tool calls were made; just use the first response as the reply.
        const replyText = response.output_text || '';

        messages.push({ role: 'assistant', content: replyText });

        return {
            thread_id: effectiveThreadId,
            reply: replyText,
        };
    } catch (err) {
        console.error('Error in getReplyFromAssistant with tools:', err?.message || err);
        return {
            thread_id: effectiveThreadId,
            reply: '',
        };
    }
}

// old-style: getReplyFromAssistant(openaiAPIKey, assistant_id, thread_id, messageContent)
export async function getReplyFromAssistantLegacy(openaiAPIKey, _assistant_id, agentSystemPrompt, thread_id, messageContent) {
  return getReplyFromAssistant({
    openaiAPIKey,
    model: 'gpt-4o',
    thread_id,
    messageContent,
  });
}
