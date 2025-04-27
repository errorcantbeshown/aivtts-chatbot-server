import Airtable from 'airtable';
import { getEmbedding } from './assistant.js';

// Airtable setup
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base('app4nfN3wFP48Mb8G');

// Fetch user memories from Airtable
async function fetchUserMemories(username) {
    const records = await base('User Memories')
        .select({
            filterByFormula: `{Username} = "${username}"`,
            maxRecords: 100, // tweak as needed
        })
        .all();
  
    return records.map(rec => ({
        id: rec.id,
        text: rec.fields.Text,
        embedding: JSON.parse(rec.fields.Embedding),
        date: rec.fields.Date,
    }));
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

// Add or update memory
export async function storeUserMemory(openaiAPIKey, username, memoryText) {
    // Generate embedding
    const embedding = await getEmbedding(openaiAPIKey, memoryText);
  
    // Save to Airtable
    await base('User Memories').create({
      Username: username,
      Text: memoryText,
      Embedding: JSON.stringify(embedding), // store as a JSON string
      Date: getCustomTimestamp(),
      EmbeddingModel: "text-embedding-3-large", // optional, but future-proof
    });
  
    console.log(`Stored new memory for ${username} in Airtable!`);
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

export async function getBatchRelevantMemoriesFromString(openaiAPIKey, batchString, maxPerUser = 2) {
    const chatBatch = parseChatBatch(batchString);
    const userMemoryMap = {};
    const SIMILARITY_THRESHOLD = 0.75;

    for (const { username, message } of chatBatch) {
        const userMemories = await fetchUserMemories(username);
        if (userMemories.length === 0) continue;

        const messageEmbedding = await getEmbedding(openaiAPIKey, message);

        const scored = userMemories.map((entry) => ({
            ...entry,
            username,
            similarity: cosineSimilarity(messageEmbedding, entry.embedding),
        }));

        const topMatches = scored
            .filter((m) => m.similarity >= SIMILARITY_THRESHOLD)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, maxPerUser);

        if (topMatches.length > 0) {
            // Accept the top similarity match
            userMemoryMap[username] = topMatches[0];
        } else {
            // Fallback: fuzzy keyword matching
            const msgKeywords = extractKeywords(message);
            const fuzzyMatch = userMemories.find(mem => {
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
    const userMemories = await fetchUserMemories(username);
    if (userMemories.length === 0) return [];

    const queryEmbedding = await getEmbedding(openaiAPIKey, query);

    const scored = userMemories.map((entry) => ({
        text: entry.text,
        score: cosineSimilarity(queryEmbedding, entry.embedding),
    }));

    return scored.sort((a, b) => b.score - a.score).slice(0, topN).map((m) => m.text);
}
