import axios from 'axios';
import { spawn } from 'child_process';

export default (req, res) => {

    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); // You can restrict this to a specific domain if needed
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Authorization, Content-Type, Origin'
    );

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    const userKey = req.query.id;
    const botKey = req.query.botKey;

    const chatBotDataRetrievalBaseURL = process.env.CHATBOT_RETRIEVAL_BASE_URL;
    const chatBotDataRetrievalURL = chatBotDataRetrievalBaseURL + '?id=' + userKey + '&botKey=' + botKey;
    
    if (req.query.id) {
        console.log('User Key Received: ' + req.query.id);
    }
    console.log('Getting Bot Data...');
    fetchJSONFromURL(chatBotDataRetrievalURL).then((data) => {
        // For Debugging
        //console.log("Retrieved Data:", data);

        if (data.authorized && data.authorized == true) {
            data.chatBot.userKey = userKey;
            console.log('Starting Bot...');
            
            // Run Twitch Process with JSON Data
            const twitchProcess = spawn('node', ['twitch.js', JSON.stringify(data.chatBot)]);

            twitchProcess.stdout.on('data', (data) => {
                console.log(`Twitch Process Output: ${data}`);
                if (data.toString().trim() === "Bot is running...") {
                    res.status(200).send('running');
                }
            });
            
            twitchProcess.stderr.on('data', (data) => {
                console.error(`Twitch Process Error: ${data}`);
            });
            
            twitchProcess.on('close', (code) => {
                console.log(`Twitch Process exited with code ${code}`);
                process.exit(0);
            });
        } else {
            console.log('Unauthorized');
            res.status(401).send('401 - Unauthorized');
        }
    });
};

async function fetchJSONFromURL(URL) {
    try {
        // Use axios to send a GET request
        const response = await axios.get(URL);

        // The JSON content will be in response.data
        //console.log("JSON Data:", response.data);
        return response.data; // Return the JSON object
    } catch (error) {
        console.error("Error fetching JSON:", error.message);
        throw error; // Handle or rethrow the error
    }
}
