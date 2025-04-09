import { getEmbedding } from './assistant.js';
import { uploadJson, downloadJson } from "./s3storage.js";

export async function loadMemory(jsonFileName) {
    try {
        const data = await downloadJson(jsonFileName);
        return data;
    } catch {
        return { users: [] };
    }
}

export function parseChatBatch(batchString) {
    return batchString.split(" ||| ").map((line) => {
        const match = line.match(/^@([^:]+):\s*(.*)$/);
        if (!match) return null;
        return {
            username: match[1],
            message: match[2],
        };
    }).filter(Boolean);
}

export async function saveMemory(jsonFileName, data) {
    await uploadJson(jsonFileName, data);
}

// Add or update memory
export async function storeUserMemory(openaiAPIKey, jsonFileName, username, memoryText) {
    const memory = await loadMemory(jsonFileName);
    const embedding = await getEmbedding(openaiAPIKey, memoryText);
    const timestamp = getCustomTimestamp();

    const newEntry = {
        text: memoryText,
        embedding,
        date: timestamp,
    };

    const user = memory.users.find((u) => u.username === username);
    if (user) {
        user.memories.push(newEntry);
    } else {
        memory.users.push({ username, memories: [newEntry] });
    }

    await saveMemory(jsonFileName, memory);
}

// Simple cosine similarity
function cosineSimilarity(vecA, vecB) {
    const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
}

function extractKeywords(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "") // remove punctuation
        .split(/\s+/)
        .filter(word => word.length > 3); // ignore very short words
}

// Create "yyyy-MM-ddTkk:mm:ssZ" timestamp
function getCustomTimestamp() {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const MM = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
  
    // "kk" format — 1–24 hour format (so midnight is 24, not 00)
    let hours = now.getUTCHours();
    const kk = String(hours === 0 ? 24 : hours).padStart(2, "0");
  
    const mm = String(now.getUTCMinutes()).padStart(2, "0");
    const ss = String(now.getUTCSeconds()).padStart(2, "0");
  
    return `${yyyy}-${MM}-${dd}T${kk}:${mm}:${ss}Z`;
}

export async function getBatchRelevantMemoriesFromString(openaiAPIKey, jsonFileName, batchString, maxPerUser = 2) {
    const chatBatch = parseChatBatch(batchString);
    const memory = await loadMemory(jsonFileName);
    const userMemoryMap = {};

    for (const { username, message } of chatBatch) {
        const user = memory.users.find((u) => u.username === username);
        if (!user || user.memories.length === 0) continue;

        const messageEmbedding = await getEmbedding(openaiAPIKey, message);
        const scored = user.memories.map((entry) => ({
            ...entry,
            username,
            similarity: cosineSimilarity(messageEmbedding, entry.embedding),
        }));

        // Sort and get top N for this user
        const topMatches = scored
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, maxPerUser);

        // Save the top one (most relevant) to represent the user
        if (topMatches.length > 0) {
            // Accept the top similarity match
            userMemoryMap[username] = topMatches[0];
        } else {
            // 🔍 Fallback: fuzzy keyword matching
            const msgKeywords = extractKeywords(message);
            const fuzzyMatch = user.memories.find(mem => {
                const memKeywords = extractKeywords(mem.text);
                return msgKeywords.some(kw => memKeywords.includes(kw));
            });

            if (fuzzyMatch && !userMemoryMap[username]) {
                console.log(`[FUZZY] Using keyword fallback for ${username}:`, fuzzyMatch.text);
                userMemoryMap[username] = {
                ...fuzzyMatch,
                username,
                similarity: 0.0, // indicate it wasn't a similarity match
                };
            }
        }
    }

    // Flatten the final list of unique user memories
    const relevantMemories = Object.values(userMemoryMap);

    return {
        chatBatch,
        relevantMemories,
    };
}

// Retrieve top N similar memories
export async function getRelevantMemories(openaiAPIKey, username, query, topN = 3) {
    const memory = await loadMemory(jsonFileName);
    const user = memory.users.find((u) => u.username === username);
    if (!user || !user.memories.length) return [];

    const queryEmbedding = await getEmbedding(openaiAPIKey, query);
    const scored = user.memories.map((mem) => ({
        text: mem.text,
        score: cosineSimilarity(queryEmbedding, mem.embedding),
    }));

    return scored.sort((a, b) => b.score - a.score).slice(0, topN).map((m) => m.text);
}
