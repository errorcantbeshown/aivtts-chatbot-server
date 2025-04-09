import OpenAI from 'openai';
import { storeUserMemory } from './memory.js';

export async function getEmbedding(openaiAPIKey, text) {
    const openai = new OpenAI({
        apiKey: openaiAPIKey,
    });

    const res = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
        encoding_format: "float",
    });
    return res.data[0].embedding;
}

export async function getReplyFromAssistant(openaiAPIKey, assistant_id, assistantMemoryJSON, thread_id, messageContent) {

    const openai = new OpenAI({
        apiKey: openaiAPIKey,
    });

    if (!thread_id) {
        console.log("No Thread ID specified, creating new Thread...");
        const thread = await openai.beta.threads.create();
        thread_id = thread.id;
        console.log("New Thread ID: " + thread_id);
    } else { console.log("Current Thread ID: " + thread_id); }

    // Send user message
    await openai.beta.threads.messages.create(
        thread_id,
        {
            role: "user",
            content: messageContent
        }
    );

    try {
        let run = runWithFailOverAndRetry(openaiAPIKey, thread_id, assistant_id);
        let runCompleted = false;
        let finalReply = "";

        if (!run || !run.id) {
            throw new Error("Failed to create run or run ID missing.");
        }
        
        // Poll loop for run completion
        while (["queued", "in_progress", "requires_action"].includes(run.status)) {
            console.log("Current run status:", run.status);

            if (run.status === "requires_action") {
                const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || [];

                for (const call of toolCalls) {
                    if (call.function.name === "storeUserMemory") {
                        const args = JSON.parse(call.function.arguments);
                        console.log(`Storing memory for ${args.username}: ${args.memory}`);
                        await storeUserMemory(openaiAPIKey, assistantMemoryJSON, args.username, args.memory);
                    }
                }

                // Submit tool outputs
                await openai.beta.threads.runs.submitToolOutputs(thread_id, run.id, {
                    tool_outputs: toolCalls.map((call) => ({
                        tool_call_id: call.id,
                        output: "Memory stored!",
                    })),
                });
            }

            // Wait and re-fetch run status
            await new Promise((resolve) => setTimeout(resolve, 1000));
            run = await openai.beta.threads.runs.retrieve(thread_id, run.id);
        }

        console.log("Final run status:", run.status);

        // Check if it's now completed
        if (run.status === "completed") {
            const messages = await openai.beta.threads.messages.list(
                run.thread_id,
                {
                    limit: 2,
                }
            );

            for (const message of messages.data) {
                if (message.role === "assistant") {
                    console.log("Assistant's reply is ready!");
                    finalReply = message.content?.[0]?.text?.value || "";
                    runCompleted = true;
                    break;
                }
            }
        }

        if (runCompleted) {
            return {
                thread_id: thread_id,
                reply: finalReply,
            };
        } else {
            console.log("No Assistant reply! Final run status: " + run.status);
            return {
                thread_id: thread_id,
                reply: "",
            };
        }
    } catch (err) {
        console.error("Could NOT perform run!", err.message);
        return {
            thread_id: thread_id,
            reply: "",
        };
    }
}

async function runWithFailOverAndRetry(openaiAPIKey, thread_id, assistant_id) {
    const openai = new OpenAI({
        apiKey: openaiAPIKey,
    });

    try {
        let run = await openai.beta.threads.runs.create(
            thread_id,
            { 
                assistant_id: assistant_id
            }
        );
        return run;
    } catch (err) {
        if (err.message.includes("TPM")) {
            console.warn("TPM limit exceeded — rolling thread...");
            const newThreadID = await rollOverThread(thread.id, assistant_id);
            let run = await openai.beta.threads.runs.create(
                newThreadID,
                { 
                    assistant_id: assistant_id
                }
            );
            return run;
        } else {
            throw err; // bubble up other errors
        }
    }
}

async function rollOverThread(openaiAPIKey, thread_id) {
    const openai = new OpenAI({
        apiKey: openaiAPIKey,
    });

    const messages = await openai.beta.threads.messages.list(thread_id, { limit: 20 });
    const newThread = await openai.beta.threads.create();
  
    // Copy over the last ~6 messages (3 user/assistant pairs)
    const lastMessages = messages.data
        .filter(msg => msg.role === "user" || msg.role === "assistant")
        .slice(0, 6)
        .reverse();
  
    for (const msg of lastMessages) {
        await openai.beta.threads.messages.create(newThread.id, {
            role: msg.role,
            content: msg.content.map(c => c.text.value).join("\n"),
        });
    }
  
    return newThread.id;
}
