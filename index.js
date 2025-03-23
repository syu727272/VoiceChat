
require('dotenv').config();
const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// SDP形式のリクエストボディを処理するためのミドルウェア
app.use(express.text({ type: 'application/sdp' }));
app.use(express.json());

// リクエストボディをそのまま保持するミドルウェア
app.use((req, res, next) => {
  if (req.headers['content-type'] === 'application/sdp') {
    req.rawBody = req.body;
  }
  next();
});

// Session token endpoint - provides ephemeral key for OpenAI API
app.get('/session', async (req, res) => {
  try {
    // In a production environment, you would want to generate a proper ephemeral key
    // For this demo, we'll just pass the API key from .env
    res.json({
      client_secret: {
        value: process.env.OPENAI_API_KEY
      }
    });
  } catch (error) {
    console.error('Error generating session token:', error);
    res.status(500).json({ error: 'Failed to generate session token' });
  }
});

// Proxy endpoint for OpenAI Realtime API
app.post('/api/realtime/sdp', async (req, res) => {
  try {
    const model = req.query.model || 'gpt-4o-mini-realtime-preview-2024-12-17';
    const baseUrl = 'https://api.openai.com/v1/realtime';
    
    // Add voice parameter if provided
    const voice = req.query.voice || 'alloy';
    const response = await fetch(`${baseUrl}?model=${model}&voice=${voice}`, {
      method: 'POST',
      body: req.rawBody || req.body,
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/sdp'
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);
      return res.status(response.status).send(errorText);
    }
    
    const sdpAnswer = await response.text();
    res.setHeader('Content-Type', 'application/sdp');
    res.send(sdpAnswer);
  } catch (error) {
    console.error('Error proxying to OpenAI:', error);
    res.status(500).json({ error: 'Failed to connect to OpenAI API' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
