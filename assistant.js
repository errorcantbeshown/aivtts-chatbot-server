import OpenAI from 'openai';

export async function getReplyFromAssistant(openaiAPIKey, assistant_id, thread_id, messageContent) {

    const openai = new OpenAI({
        apiKey: openaiAPIKey,
    });

    if (!thread_id) {
        console.log("No Thread ID specified, creating new Thread...");
        const thread = await openai.beta.threads.create();
        thread_id = thread.id;
        console.log("New Thread ID: " + thread_id);
    } else { console.log("Current Thread ID: " + thread_id); }

    const message = await openai.beta.threads.messages.create(
        thread_id,
        {
            role: "user",
            content: messageContent
        }
    );

    let run = await openai.beta.threads.runs.createAndPoll(
        thread_id,
        { 
            assistant_id: assistant_id
        }
    );

    if (run.status === 'completed') {
        const messages = await openai.beta.threads.messages.list(
            run.thread_id,
            {
                limit: 2
            }
        );

        for (const message of messages.data) {
            if (message.role === 'assistant') {
                console.log("Assistant's reply is ready!");
                return {
                    thread_id: thread_id,
                    reply: `${message.content[0].text.value}`,
                };
            }
        }
    } else {
        console.log("No Assistant Reply! Run Status: " + run.status);
        return {
            thread_id: thread_id,
            reply: "",
        };
    }
}