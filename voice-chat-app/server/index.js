require('dotenv').config();
const express = require('express');
const path = require('path');
const { OpenAI } = require('openai');
const https = require('https');
const axios = require('axios').default; // axiosを使用してHTTPリクエストを行う

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// Endpoint to create an ephemeral key for the client
app.get('/session', async (req, res) => {
  try {
    console.log('Creating session for client');
    
    // APIキーの存在確認
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is missing in environment variables');
      return res.status(401).json({ 
        error: 'API key not configured', 
        details: 'Please set up a valid OpenAI API key in your .env file',
        demo_mode: true 
      });
    }
    
    // APIキーの形式チェック（基本的な検証）
    if (!process.env.OPENAI_API_KEY.startsWith('sk-') || process.env.OPENAI_API_KEY.length < 30) {
      console.error('OPENAI_API_KEY appears to be invalid (does not match expected format)');
      return res.status(401).json({ 
        error: 'API key appears to be invalid', 
        details: 'The API key does not match the expected format',
        demo_mode: true 
      });
    }
    
    console.log('Preparing API authentication for WebRTC');
    
    res.json({
      client_secret: {
        value: process.env.OPENAI_API_KEY
      }
    });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ 
      error: error.message,
      demo_mode: true
    });
  }
});

// OpenAIのRealtime APIへのプロキシエンドポイントを追加してCORS問題を回避
app.post('/api/realtime/sdp', express.text({ type: '*/*' }), async (req, res) => {
  try {
    // 指定されたモデルを取得する（クライアントから指定されたモデルを使用）
    const model = req.query.model || 'gpt-4o';
    console.log(`Proxying SDP request to OpenAI Realtime API for model: ${model}`);
    console.log(`SDP Request body length: ${req.body.length} bytes`);
    
    // API Key診断
    if (!process.env.OPENAI_API_KEY) {
      console.error('CRITICAL ERROR: OPENAI_API_KEY is not set');
      return res.status(401).send({
        error: {
          message: 'API key is not configured on the server',
          type: 'authentication_error',
          code: 'api_key_missing'
        }
      });
    }
    
    if (!process.env.OPENAI_API_KEY.startsWith('sk-')) {
      console.error('CRITICAL ERROR: OPENAI_API_KEY is malformed, should start with "sk-"');
      return res.status(401).send({
        error: {
          message: 'API key is malformed, should start with "sk-"',
          type: 'authentication_error',
          code: 'api_key_malformed'
        }
      });
    }
    
    // ヘッダーを表示（APIキーは一部のみ表示して安全性を保つ）
    const apiKeyPrefix = process.env.OPENAI_API_KEY.substring(0, 7);
    const apiKeySuffix = process.env.OPENAI_API_KEY.substring(process.env.OPENAI_API_KEY.length - 4);
    console.log(`Using API key: ${apiKeyPrefix}...${apiKeySuffix} (${process.env.OPENAI_API_KEY.length} chars)`);
    console.log(`Requesting model: ${model}`);
    
    // OpenAIのRealtime APIに直接SDPリクエストを送信
    console.log('Sending request to OpenAI Realtime API...');
    const response = await axios({
      method: 'POST',
      url: `https://api.openai.com/v1/realtime?model=${model}`,
      headers: {
        'Content-Type': 'application/sdp',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime' // Betaヘッダーを追加（ドキュメントに基づく）
      },
      data: req.body, // SDPをそのまま送信
      responseType: 'text'
    });
    
    console.log('SDP Response received from OpenAI:', response.status);
    
    // SDPレスポンスをそのままクライアントに返す
    res.set('Content-Type', 'application/sdp');
    res.send(response.data);
    
  } catch (error) {
    console.error('Error proxying SDP request to OpenAI Realtime API:', error.message);
    
    if (error.response) {
      // APIからのエラーレスポンスがある場合
      console.error(`OpenAI API error: ${error.response.status}`);
      
      let errorDetails = error.response.data || { error: { message: 'Unknown error' } };
      
      // 401エラーの場合、より具体的な情報を提供
      if (error.response.status === 401) {
        console.error('Authentication error with OpenAI API - API key may be invalid or lacks access to this model');
        errorDetails = {
          error: {
            message: 'OpenAI API authentication failed. Your API key may be invalid or you may not have access to this model.',
            type: 'authentication_error',
            code: 'api_key_invalid'
          }
        };
      }
      
      // 404エラーの場合、モデルが存在しない可能性
      if (error.response.status === 404) {
        console.error('Requested model may not exist or you may not have access to it');
        errorDetails = {
          error: {
            message: 'The requested model does not exist or you may not have access to it.',
            type: 'model_error',
            code: 'model_not_found'
          }
        };
      }
      
      // エラー詳細をログとクライアントに送信
      if (errorDetails) {
        console.error(`Error details: ${typeof errorDetails === 'string' ? errorDetails : JSON.stringify(errorDetails)}`);
      }
      
      return res.status(error.response.status).send(errorDetails);
    } else if (error.request) {
      // リクエストは送信されたが応答がない場合
      console.error('No response received from OpenAI API');  
      return res.status(500).send({
        error: {
          message: 'No response received from OpenAI API. The service may be down or unreachable.',
          type: 'api_connection_error',
          code: 'network_error'
        }
      });
    } else {
      // リクエストの設定中に問題が発生した場合
      console.error('Error setting up OpenAI API request:', error.message);
      return res.status(500).send({
        error: {
          message: `Error setting up request: ${error.message}`,
          type: 'request_setup_error',
          code: 'setup_failed'
        }
      });
    }
  }
});

// OpenAIの音声生成API用のエンドポイント
app.post('/api/speech', express.text({ type: '*/*' }), async (req, res) => {
  try {
    // クエリパラメータからモデルとボイスを取得
    const model = req.query.model || 'tts-1';
    const voice = req.query.voice || 'alloy';
    
    // リクエストボディのチェック
    if (!req.body) {
      throw new Error('Missing request body');
    }
    
    // リクエスト内容のログを出力
    console.log(`Processing Text-to-Speech request with model: ${model}, voice: ${voice}`);
    console.log(`Input text length: ${req.body.length} bytes`);
    
    try {
      // OpenAIの音声生成APIにリクエストを送信
      const response = await axios({
        method: 'POST',
        url: 'https://api.openai.com/v1/audio/speech',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        data: JSON.stringify({
          model: model,
          input: req.body,
          voice: voice,
          response_format: "mp3"
        }),
        responseType: 'arraybuffer'
      });
      
      console.log('Audio response received from OpenAI:', response.status);
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Disposition', 'attachment; filename="response.mp3"');
      res.send(response.data);
      
    } catch (apiError) {
      if (apiError.response) {
        // APIからのエラーレスポンスがある場合
        console.error(`OpenAI API error: ${apiError.response.status}`);
        
        // エラーレスポンスの処理
        let errorMessage = '';
        if (apiError.response.data instanceof Buffer) {
          errorMessage = apiError.response.data.toString('utf8');
        } else if (typeof apiError.response.data === 'object') {
          errorMessage = JSON.stringify(apiError.response.data);
        } else {
          errorMessage = apiError.response.data;
        }
        
        console.error('Error data:', errorMessage);
        return res.status(apiError.response.status).send(errorMessage);
      } else if (apiError.request) {
        // リクエストは送信されたが応答がない場合
        console.error('No response received from OpenAI API:', apiError.message);
        return res.status(500).send('No response from OpenAI API');
      } else {
        // リクエストの設定中に問題が発生した場合
        console.error('Error setting up OpenAI API request:', apiError.message);
        return res.status(500).send(`Request setup error: ${apiError.message}`);
      }
    }
  } catch (error) {
    console.error('Error processing speech request:', error);
    res.status(500).send(error.message);
  }
});

// Serve the main application
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
