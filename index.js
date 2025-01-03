import express from 'express';
import startBot from './startbot.js';

const app = express();
const PORT = process.env.PORT || 8080;

// Map robots.txt
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(`
    User-agent: *
    Disallow: /
    `);
});

// Map Start Bot module to a URL path
app.get('/start', startBot);

// Serve HTML content on the root route
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>ChatBot | AI Voice TTS</title>
        </head>
        <body>
            <h1>Welcome to the ChatBot Server!</h1>
            <p>There is nothing here. Sorry.</p>
        </body>
        </html>
    `);
});



app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});