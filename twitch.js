import axios from 'axios';
import { Client } from 'tmi.js';
import { performance } from 'perf_hooks';
import { getReplyFromAssistant } from './assistant.js';

const chatBotDataUpdateBaseURL = process.env.CHATBOT_UPDATE_BASE_URL;

const chatBotJSON = JSON.parse(process.argv[2]);

const client = new Client({
	options: { debug: false },
	identity: {
		username: chatBotJSON.botTwitchUserName,
		password: chatBotJSON.botTwitchOAuthToken
	},
	channels: [ chatBotJSON.twitchChannel ]
});

let timerStart = performance.now();
const openaiAPIKey = chatBotJSON.openaiAPIKey;
const assistant_id = chatBotJSON.openaiAssistantID;
let thread_id = chatBotJSON.openaiPreviousThreadID;
let startMessageResponse = await getReplyFromAssistant(openaiAPIKey, assistant_id, thread_id, chatBotJSON.startMessageToBot);
let chatMessagesArray = [];
let botChattedLast = true;

const entryLines = createPercentageBasedArray(chatBotJSON.entryLineList);
const exitLines = createPercentageBasedArray(chatBotJSON.exitLineList);

const replyDecisionList = [
	{entry: "true", percentage: 50},
	{entry: "false", percentage: 50}
];
const replyDecisions = createPercentageBasedArray(replyDecisionList);


client.addListener('connected', function() {
	console.log("Bot is running...");
	thread_id = startMessageResponse.thread_id;
	client.say(chatBotJSON.twitchChannel, entryLines[(Math.floor(Math.random() * entryLines.length))]);
	updateChatBotInDatabaseInfo(chatBotDataUpdateBaseURL, chatBotJSON.userKey, chatBotJSON.id, thread_id, "running");
});

client.connect();

client.on('message', (listeningChannel, tags, message, self) => {
	// Ignore echoed messages.
	if (self) return;

	// For Debugging
	//console.log("TAGS: " + JSON.stringify(tags));
	//console.log(`@${tags['username']}: ${message.replaceAll(' ||| ', ' ')}`);

	if (tags.badges && tags.badges.broadcaster && tags.badges.broadcaster == "1" && message.startsWith('!')) {
		const args = message.slice(1).split(' ');
		const command = args.shift().toLowerCase();

		if (command == chatBotJSON.dismissCommand) {
			console.log("Dismiss command received. Bot leaving...");
			resetChatMessageCollection();
			client.say(listeningChannel, exitLines[(Math.floor(Math.random() * exitLines.length))]);
			shutdown();
		}
	} else {
		// Add chat message to collection
		chatMessagesArray.push(`@${tags['username']}: ${message.replaceAll(' ||| ', ' ').trim()}`);
	}
});

function checkTime() {
	const now = performance.now();
    	const elapsedTime = (now - timerStart) / 1000; // Convert to seconds

	if (chatMessagesArray.length != 0 && elapsedTime >= 300) {
		botChattedLast = false;
		replyToChatMessages(chatBotJSON.twitchChannel, chatMessagesArray);
	
		// Reset the timer
	timerStart = performance.now();
		resetChatMessageCollection();
	} else if (!botChattedLast && elapsedTime >= 480) {
		console.log("Lull in chat activity (8 minutes without any chat activity). Bot sending unprompted message...");
		sendUnpromptedChatMessage(chatBotJSON.twitchChannel);
		botChattedLast = true;
	
		// Reset the timer
	timerStart = performance.now();
	} else if (elapsedTime >= 540) {
		console.log("Timeout triggered (15 minutes without non-bot chat activity). Bot leaving...");
		client.say(chatBotJSON.twitchChannel, "Ah, I seem to be the only one here... I'll just see myself out then.");
		shutdown();
	}
}

function createPercentageBasedArray(entryPercentList) {
	let resultArray = [];

	entryPercentList.forEach(item => {
		let { entry, percentage } = item;

		// Calculate the number of times the 'entry' should appear, based on percentage of 100
		let count = Math.round((percentage / 100) * 100);
		resultArray.push(...Array(count).fill(entry));
	});

	// Adjust the array to ensure it has exactly 100 items
	if (resultArray.length > 100) {
		resultArray = resultArray.slice(0, 100);
	} else if (resultArray.length < 100) {
		let deficit = 100 - resultArray.length;

		// If the array is too short, fill the remaining slots with the first entry in the list
		resultArray.push(...Array(deficit).fill(entryPercentList[0].name));
	}

	return resultArray;
}

// Function to add a delay
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Async function to loop through the array with delay
async function sendChatMessagesWithDelay(channel, chatMessageArray, delayTime) {
    for (const chatMessage of chatMessageArray) {
        client.say(channel, chatMessage); // Perform any action with the current string
        await delay(delayTime); // Wait for the specified delay
    }
}

async function replyToChatMessages(replyChannel, collectedChatMessages) {
	const chatMessagesString = collectedChatMessages.join(' ||| ').replace(/"/g, '');

	// Decided whether to actually reply to chat messages by weighted dice roll or if someone has mentioned the bot/assistant.
	const reply = (replyDecisions[(Math.floor(Math.random() * replyDecisions.length))] == "true" || chatMessagesString.toLowerCase().includes(chatBotJSON.botName.toLowerCase()));
	if (reply) {
		const content = "Here are the most recent messages from Twitch Chat, please respond to this in less than 500 characters: " + chatMessagesString;
		const response = await getReplyFromAssistant(openaiAPIKey, assistant_id, thread_id, content);

		// Check if Assistant has any chat messages that should be sent separately.
		if (response.reply.includes(" ||| ")) {
			const replyArray = response.reply.split(" ||| ");
			sendChatMessagesWithDelay(replyChannel, replyArray, 200);
		} else {
			client.say(replyChannel, response.reply);
		}

		thread_id = response.thread_id;
	} else {
		const content = "Here are the most recent messages from Twitch Chat, don't come up with a response to them — your reply won't be sent. This is just to keep you informed on what's being said: " + chatMessagesString;
		const response = await getReplyFromAssistant(openaiAPIKey, assistant_id, thread_id, content);
    	thread_id = response.thread_id;
	}
}

function resetChatMessageCollection() {
	chatMessagesArray = [];
}

async function sendUnpromptedChatMessage(channel) {
	const content = "There have not been any new chat messages recently, please come up with you'd like to say in Twitch Chat.";
    const response = await getReplyFromAssistant(openaiAPIKey, assistant_id, thread_id, content);
    client.say(channel, response.reply);
	thread_id = response.thread_id;
}

async function shutdown() {
	await updateChatBotInDatabaseInfo(chatBotDataUpdateBaseURL, chatBotJSON.userKey, chatBotJSON.id, thread_id, "stopped");
	client.disconnect();
	process.exit(0);
}

async function updateChatBotInDatabaseInfo(BASE_URL, userKey, botKey, threadID, status) {
    try {
        // Use axios to send a GET request
        const response = await axios.get(BASE_URL + "?id=" + userKey + "&botKey=" + botKey + "&threadID=" + threadID + "&status=" + status);
        
        // The response.data should be either "updated" OR "failed"
        console.log("Main App Response Data:", response.data);
        try {
            if (response.data === "updated") {
                console.log('Updated Chat Bot in Database.');
            } else {
                console.log('Failed to update Chat Bot in Database.');
            }
        } catch (err) { console.error("Unable to determine if Chat Bot was updated in Database:", err.message); }
    } catch (error) { console.error("Error updating Chat Bot in Database:", error.message); }
}

async function renderKeepAlive(userKey, botKey) {
	try {
        // Use axios to send a POST request
        const response = await axios.post(process.env.KEEP_ALIVE_CRONJOB_URL + "?id=" + userKey + "&botKey=" + botKey);
        
        // The response.data should be either "started" OR "failed"
        try {
            if (response.data === "started") {
                console.log('Keep Alive CronJob Started.');
            } else {
                console.log('Failed to start Keep Alive CronJob.');
            }
        } catch (err) { console.error("Unable to determine if Keep Alive CronJob was started:", err.message); }
    } catch (error) { console.error("Error starting Keep Alive CronJob:", error.message); }
}

// Periodically check the time (e.g., every 10 seconds)
setInterval(checkTime, 10000);

// Keep Render Server Alive (Every 2.5 mins)
setInterval(renderKeepAlive(chatBotJSON.userKey, chatBotJSON.id), 150000);
