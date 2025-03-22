document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const voiceSelect = document.getElementById('voice-select');
    const audioDeviceSelect = document.getElementById('audio-device-select');
    const refreshDevicesBtn = document.getElementById('refresh-devices-btn');
    const statusLight = document.getElementById('status-light');
    const statusText = document.getElementById('status-text');
    const conversation = document.getElementById('conversation');
    const logContainer = document.getElementById('log');
    const waveformCanvas = document.getElementById('waveform-canvas');
    const waveformCtx = waveformCanvas.getContext('2d');

    // State variables
    let peerConnection = null;
    let dataChannel = null;
    let mediaStream = null;
    let recordingStartTime = null;
    let isRecording = false;
    let isConnected = false;
    let isListening = false;
    let selectedAudioDeviceId = null;
    
    // Audio analysis variables
    let audioContext = null;
    let analyser = null;
    let dataArray = null;
    let animationFrameId = null;
    
    // Constants
    const MODEL = 'gpt-4o'; // より広くアクセス可能なモデルに変更
    const BASE_URL = 'https://api.openai.com/v1/realtime';

    // Logging function
    function addLogEntry(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.innerHTML = `<span class="log-time">[${timestamp}]</span> <span class="log-${type}">${message}</span>`;
        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    // Add a message to the conversation
    function addMessage(text, sender, metadata = {}) {
        const messageEl = document.createElement('div');
        messageEl.className = `message ${sender}`;
        
        // Create header with sender and metadata
        const headerEl = document.createElement('div');
        headerEl.className = 'message-header';
        
        // Create sender label
        const senderLabel = document.createElement('span');
        senderLabel.textContent = sender === 'user' ? 'You' : 'AI';
        
        // Create metadata label
        const metadataLabel = document.createElement('span');
        if (metadata.startTime) {
            const formattedTime = new Date(metadata.startTime).toLocaleTimeString();
            metadataLabel.textContent = `${formattedTime}`;
            
            if (metadata.duration) {
                metadataLabel.textContent += ` (${metadata.duration.toFixed(2)}s)`;
            }
        }
        
        headerEl.appendChild(senderLabel);
        headerEl.appendChild(metadataLabel);
        
        // Create message text
        const textEl = document.createElement('div');
        textEl.className = 'message-text';
        textEl.textContent = text;
        
        // Append all elements
        messageEl.appendChild(headerEl);
        messageEl.appendChild(textEl);
        
        conversation.appendChild(messageEl);
        conversation.scrollTop = conversation.scrollHeight;
    }

    // Update UI status
    function updateStatus(status, message = null) {
        switch (status) {
            case 'disconnected':
                statusLight.className = 'status-light disconnected';
                statusText.textContent = message || 'Disconnected';
                startBtn.disabled = false;
                stopBtn.disabled = true;
                break;
            case 'connecting':
                statusLight.className = 'status-light disconnected';
                statusText.textContent = message || 'Connecting...';
                startBtn.disabled = true;
                stopBtn.disabled = false;
                break;
            case 'connected':
                statusLight.className = 'status-light connected';
                statusText.textContent = message || 'Connected';
                startBtn.disabled = true;
                stopBtn.disabled = false;
                break;
            case 'listening':
                statusLight.className = 'status-light listening';
                statusText.textContent = message || 'Listening...';
                startBtn.disabled = true;
                stopBtn.disabled = false;
                break;
            case 'error':
                statusLight.className = 'status-light error';
                statusText.textContent = message || 'Error';
                startBtn.disabled = false;
                stopBtn.disabled = true;
                break;
        }
    }

    // 接続リトライ機能
    let retryCount = 0;
    const MAX_RETRIES = 3;
    let retryTimeout = null;
    
    // Initialize the Voice Chat using OpenAI's Realtime API with WebRTC
    async function init() {
        try {
            // 既存の接続があれば一旦クリーンアップ
            if (peerConnection) {
                cleanup(false);
            }
            
            updateStatus('connecting');
            addLogEntry('Initializing voice connection...', 'info');
            
            // Get an ephemeral key from server
            const tokenResponse = await fetch("/session");
            if (!tokenResponse.ok) {
                throw new Error(`Server responded with status: ${tokenResponse.status}`);
            }
            
            const data = await tokenResponse.json();
            
            // データの存在確認と検証
            if (!data || !data.client_secret || !data.client_secret.value) {
                throw new Error('Invalid API key data received from server. Check server logs.');
            }
            
            const EPHEMERAL_KEY = data.client_secret.value;
            addLogEntry('Session token received', 'success');
            
            // Create a peer connection
            peerConnection = new RTCPeerConnection({
                iceCandidatePoolSize: 10,
                iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }]
            });
            
            // 接続状態の監視
            peerConnection.oniceconnectionstatechange = () => {
                addLogEntry(`ICE Connection State: ${peerConnection.iceConnectionState}`, 'info');
                if (peerConnection.iceConnectionState === 'disconnected' || 
                    peerConnection.iceConnectionState === 'failed' || 
                    peerConnection.iceConnectionState === 'closed') {
                    
                    // 自動的に再接続を試みる
                    if (retryCount < MAX_RETRIES) {
                        addLogEntry('Connection lost. Attempting to reconnect...', 'warning');
                        retryCount++;
                        retryTimeout = setTimeout(() => {
                            init();
                        }, 2000);
                    } else {
                        addLogEntry('Max retry attempts reached. Please reconnect manually.', 'error');
                        cleanup();
                    }
                }
            };
            
            // ICE候補者のログ記録
            peerConnection.onicecandidate = event => {
                if (event.candidate) {
                    addLogEntry('ICE candidate generated', 'info');
                }
            };
            
            // Set up to play remote audio from the model
            const audioEl = document.createElement("audio");
            audioEl.autoplay = true;
            document.body.appendChild(audioEl);
            
            // オーディオ応答を設定
            peerConnection.ontrack = e => {
                addLogEntry('Received audio track from server', 'success');
                audioEl.srcObject = e.streams[0];
            };
            
            // 音声イベントの設定
            audioEl.onplaying = () => {
                const responseStartTime = new Date();
                addLogEntry(`AI audio playback started at ${responseStartTime.toLocaleTimeString()}`, 'info');
            };
            
            audioEl.onended = () => {
                const responseEndTime = new Date();
                addLogEntry(`AI audio playback ended at ${responseEndTime.toLocaleTimeString()}`, 'info');
                updateStatus('connected');
            };
            
            audioEl.onerror = (error) => {
                addLogEntry(`Audio playback error: ${error}`, 'error');
            };
            
            // Add local audio track for microphone input
            try {
                // 選択したデバイスIDを使用してオーディオ入力を設定
                const audioConstraints = { 
                    audio: selectedAudioDeviceId ? 
                        { deviceId: { exact: selectedAudioDeviceId } } : 
                        true 
                };
                
                addLogEntry(`オーディオ入力デバイスで接続を試みています: ${audioDeviceSelect.options[audioDeviceSelect.selectedIndex].text}`, 'info');
                mediaStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
                
                addLogEntry('Microphone access granted', 'success');
                
                // Log device information
                const audioTracks = mediaStream.getAudioTracks();
                if (audioTracks.length > 0) {
                    const trackSettings = audioTracks[0].getSettings();
                    addLogEntry(`Audio device: ${trackSettings.deviceId ? 'connected' : 'unknown'}`, 'info');
                    
                    // Listen for device changes
                    audioTracks[0].onended = () => {
                        addLogEntry('Audio device disconnected', 'warning');
                        updateStatus('connected');
                        isListening = false;
                    };
                }
                
                // Set up audio analysis for waveform visualization
                setupAudioAnalysis(mediaStream);
                
                mediaStream.getAudioTracks().forEach(track => {
                    peerConnection.addTrack(track, mediaStream);
                    addLogEntry('Added local audio track to connection', 'info');
                });
                
            } catch (err) {
                addLogEntry(`Microphone access error: ${err.message}`, 'error');
                throw new Error('Microphone access required');
            }
            
            // Set up data channel for sending and receiving events
            try {
                dataChannel = peerConnection.createDataChannel("oai-events", {
                    ordered: true,
                    maxRetransmits: 3
                });
                
                dataChannel.onopen = () => {
                    addLogEntry('Data channel opened', 'success');
                    isConnected = true;
                    updateStatus('connected');
                    
                    // Set the voice ID in the first message
                    try {
                        const voiceId = voiceSelect.value;
                        const initialConfig = {
                            "type": "client_message",
                            "content": {
                                "use_voice": voiceId
                            }
                        };
                        dataChannel.send(JSON.stringify(initialConfig));
                        addLogEntry(`Set AI voice to: ${voiceId}`, 'info');
                    } catch (error) {
                        addLogEntry(`Error setting voice: ${error.message}`, 'error');
                    }
                };
                
                dataChannel.onclose = () => {
                    addLogEntry('Data channel closed', 'warning');
                    isConnected = false;
                    
                    // 自動的に再接続を試みる
                    if (retryCount < MAX_RETRIES) {
                        addLogEntry('Attempting to reestablish data channel...', 'info');
                        retryCount++;
                        retryTimeout = setTimeout(() => {
                            init();
                        }, 2000);
                    } else {
                        cleanup();
                    }
                };
                
                dataChannel.onerror = (error) => {
                    // データチャネルのエラーオブジェクトは標準的なErrorオブジェクトではないため、適切に処理
                    let errorMsg = 'Unknown error';
                    if (error) {
                        if (error.message) {
                            errorMsg = error.message;
                        } else if (error.errorDetail) {
                            errorMsg = error.errorDetail;
                        } else if (typeof error === 'object') {
                            try {
                                errorMsg = JSON.stringify(error);
                            } catch (e) {
                                errorMsg = 'Error object could not be stringified';
                            }
                        }
                    }
                    addLogEntry(`Data channel error: ${errorMsg}`, 'error');
                };
                
                dataChannel.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        // デバッグ用：受信したJSONメッセージの完全な内容をログ
                        console.log('Received message from server:', message);
                        handleServerEvent(message);
                    } catch (e) {
                        addLogEntry(`Error parsing message: ${e.message}`, 'error');
                        console.error('Original message data:', event.data);
                    }
                };
            } catch (error) {
                addLogEntry(`Error creating data channel: ${error.message}`, 'error');
            }
            
            // Start the session using the Session Description Protocol (SDP)
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true
            });
            await peerConnection.setLocalDescription(offer);
            
            addLogEntry('Created and set local connection description', 'info');
            
            // モデルを指定
            const MODEL = "gpt-4o-mini-realtime-preview-2024-12-17";
            
            // CORS問題を回避するためにプロキシリクエストを追加
            addLogEntry(`Connecting to OpenAI Realtime API with model: ${MODEL}`, 'info');
            
            // サーバープロキシを経由して接続
            const proxyUrl = `/api/realtime/sdp?model=${MODEL}`;
            addLogEntry(`Connecting through server proxy: ${proxyUrl}`, 'info');
            
            // サーバー側のプロキシエンドポイントを使用
            const sdpResponse = await fetch(proxyUrl, {
                method: "POST",
                body: offer.sdp,
                headers: {
                    "Content-Type": "application/sdp"
                }
            });
            
            if (!sdpResponse.ok) {
                let errorInfo = 'Unknown error';
                try {
                    // レスポンスをJSONとして解析
                    const errorResponse = await sdpResponse.text();
                    let errorJson;
                    try {
                        errorJson = JSON.parse(errorResponse);
                    } catch (e) {
                        // JSONでない場合はテキストとして使用
                        errorInfo = errorResponse;
                    }
                    
                    if (errorJson && errorJson.error) {
                        const error = errorJson.error;
                        // 認証エラーの場合
                        if (error.type === 'authentication_error' || sdpResponse.status === 401) {
                            errorInfo = 'API Key認証エラー: OpenAIのAPIキーが無効または権限がありません。.envファイルのAPIキーを確認してください。';
                            addLogEntry(errorInfo, 'error');
                            updateStatus('error', 'API認証エラー');
                        } 
                        // モデルが見つからない場合
                        else if (error.type === 'model_error' || sdpResponse.status === 404) {
                            errorInfo = `モデルエラー: モデル「${MODEL}」が存在しないか、アクセス権がありません。`;
                            addLogEntry(errorInfo, 'error');
                            updateStatus('error', 'モデルエラー');
                        }
                        // その他のエラーメッセージがある場合
                        else if (error.message) {
                            errorInfo = error.message;
                        }
                    }
                } catch (e) {
                    console.error('Error parsing error response:', e);
                }
                
                throw new Error(`SDP response error: ${errorInfo}`);
            }
            
            const answer = {
                type: "answer",
                sdp: await sdpResponse.text()
            };
            
            await peerConnection.setRemoteDescription(answer);
            addLogEntry('Remote description set, connection established', 'success');
            
            hasInitializedConnection = true;
            
        } catch (error) {
            addLogEntry(`Initialization error: ${error.message}`, 'error');
            cleanup();
        }
    }

    // Handle events from the server
    function handleServerEvent(message) {
        try {
            addLogEntry(`Received event: ${message.type}`, 'info');
            
            switch (message.type) {
                case 'server_message':
                    // Handle server messages
                    if (message.content && message.content.role === 'assistant') {
                        // This is the AI's response
                        const aiMessage = message.content.content[0].text;
                        
                        // Calculate response time if we were recording
                        let responseMetadata = {
                            startTime: new Date()
                        };
                        
                        if (recordingStartTime) {
                            const responseTime = (new Date() - recordingStartTime) / 1000;
                            responseMetadata.duration = responseTime;
                            addLogEntry(`AI response received after ${responseTime.toFixed(2)}s`, 'success');
                            recordingStartTime = null;
                        }
                        
                        addMessage(aiMessage, 'ai', responseMetadata);
                    }
                    break;
                    
                case 'speech_started':
                    // AI started speaking
                    addLogEntry('AI started speaking', 'info');
                    break;
                    
                case 'speech_ended':
                    // AI finished speaking
                    addLogEntry('AI finished speaking', 'info');
                    break;
                    
                case 'content_block_start':
                    addLogEntry('Content block started', 'info');
                    break;
                    
                case 'content_block_delta':
                    // Real-time content updates, could add partial responses here
                    break;
                    
                case 'content_block_stop':
                    addLogEntry('Content block stopped', 'info');
                    break;
                    
                case 'metadata':
                    addLogEntry(`Metadata: ${JSON.stringify(message.data)}`, 'info');
                    break;
                    
                case 'session.created':
                    addLogEntry(`Session created: ${JSON.stringify(message.data || {})}`, 'success');
                    break;
                    
                case 'session.updated':
                    addLogEntry(`Session updated: ${JSON.stringify(message.data || {})}`, 'info');
                    break;
                    
                case 'error':
                    // エラーオブジェクトをより詳細に表示
                    let errorDetails = 'Unknown error';
                    if (typeof message.error === 'object') {
                        try {
                            errorDetails = JSON.stringify(message.error);
                        } catch (e) {
                            errorDetails = 'Error object could not be stringified';
                        }
                    } else if (message.error) {
                        errorDetails = message.error.toString();
                    }
                    addLogEntry(`Error from server: ${errorDetails}`, 'error');
                    break;
                    
                default:
                    addLogEntry(`Unknown event type: ${message.type}`, 'warning');
            }
        } catch (error) {
            addLogEntry(`Error handling server event: ${error.message}`, 'error');
        }
    }

    // Handle the start of audio recording
    function handleRecordingStart() {
        if (!isConnected) return;
        
        try {
            isListening = true;
            recordingStartTime = new Date();
            updateStatus('listening');
            
            // Start waveform visualization
            startWaveformAnimation();
            
            // Visual indicator that we're recording
            const recordingStartTimestamp = recordingStartTime.toLocaleTimeString();
            addLogEntry(`Recording started at ${recordingStartTimestamp}`, 'info');
            
            // Send a start message to indicate user is talking
            if (dataChannel && dataChannel.readyState === 'open') {
                const startMessage = {
                    "type": "client_message",
                    "content": {
                        "role": "user",
                        "content": [
                            { "type": "voice" }
                        ]
                    }
                };
                dataChannel.send(JSON.stringify(startMessage));
            }
        } catch (error) {
            addLogEntry(`Error starting recording: ${error.message}`, 'error');
        }
    }

    // Handle the end of audio recording
    function handleRecordingEnd() {
        if (!isListening) return;
        
        try {
            isListening = false;
            updateStatus('connected');
            
            // Stop waveform visualization
            stopWaveformAnimation();
            
            const recordingEndTime = new Date();
            const duration = (recordingEndTime - recordingStartTime) / 1000;
            
            addLogEntry(`Recording ended after ${duration.toFixed(2)}s`, 'info');
            
            // Add the user message to the conversation
            addMessage('🎤 Voice message', 'user', {
                startTime: recordingStartTime,
                duration: duration
            });
            
            // Send end message
            if (dataChannel && dataChannel.readyState === 'open') {
                const endMessage = {
                    "type": "client_message_end"
                };
                dataChannel.send(JSON.stringify(endMessage));
            }
        } catch (error) {
            addLogEntry(`Error ending recording: ${error.message}`, 'error');
        }
    }

    // Clean up resources and reset UI
    function cleanup(updateUI = true) {
        // リトライタイマーをクリア
        if (retryTimeout) {
            clearTimeout(retryTimeout);
            retryTimeout = null;
        }
        
        // Stop waveform animation
        stopWaveformAnimation();
        
        // Clean up audio context
        if (audioContext && audioContext.state !== 'closed') {
            try {
                audioContext.close();
            } catch (e) {
                console.error('Error closing audio context:', e);
            }
            audioContext = null;
            analyser = null;
            dataArray = null;
        }
        
        // Stop all media tracks
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => {
                try {
                    track.stop();
                } catch (e) {
                    console.error('Error stopping track:', e);
                }
            });
            mediaStream = null;
        }
        
        // Close data channel
        if (dataChannel) {
            try {
                dataChannel.close();
            } catch (e) {
                console.error('Error closing data channel:', e);
            }
            dataChannel = null;
        }
        
        // Close peer connection
        if (peerConnection) {
            try {
                // 全てのイベントリスナーを削除
                peerConnection.oniceconnectionstatechange = null;
                peerConnection.onicecandidate = null;
                peerConnection.ontrack = null;
                peerConnection.ondatachannel = null;
                peerConnection.close();
            } catch (e) {
                console.error('Error closing peer connection:', e);
            }
            peerConnection = null;
        }
        
        // 録音状態のリセット
        isRecording = false;
        isConnected = false;
        isListening = false;
        recordingStartTime = null;
        
        if (updateUI) {
            updateStatus('disconnected');
            addLogEntry('Connection cleaned up', 'info');
        }
        
        // 音声再生用の要素を削除
        const audioElements = document.querySelectorAll('audio');
        audioElements.forEach(el => {
            if (el.parentNode) {
                el.parentNode.removeChild(el);
            }
        });
    }

    // Event Listeners
    startBtn.addEventListener('click', async () => {
        await init();
    });

    stopBtn.addEventListener('click', () => {
        if (isListening) {
            handleRecordingEnd();
        }
        cleanup();
    });
    
    // Add event listener for voice selection changes
    voiceSelect.addEventListener('change', () => {
        const voiceId = voiceSelect.value;
        addLogEntry(`Voice changed to: ${voiceId}`, 'info');
        
        if (isConnected && dataChannel && dataChannel.readyState === 'open') {
            const voiceChangeMessage = {
                "type": "client_message",
                "content": {
                    "use_voice": voiceId
                }
            };
            dataChannel.send(JSON.stringify(voiceChangeMessage));
        }
    });
    
    // Add keyboard shortcuts for starting/stopping recording
    document.addEventListener('keydown', (event) => {
        // Press spacebar to toggle recording
        if (event.code === 'Space' && isConnected) {
            event.preventDefault();
            
            if (isListening) {
                handleRecordingEnd();
            } else {
                handleRecordingStart();
            }
        }
    });
    
    // Add touchstart/mousedown and touchend/mouseup events for recording
    const recordButton = document.createElement('div');
    recordButton.className = 'record-button';
    recordButton.textContent = '🎤 Hold to Speak';
    recordButton.style.position = 'fixed';
    recordButton.style.bottom = '20px';
    recordButton.style.left = '50%';
    recordButton.style.transform = 'translateX(-50%)';
    recordButton.style.padding = '15px 30px';
    recordButton.style.backgroundColor = 'var(--primary-color)';
    recordButton.style.color = 'white';
    recordButton.style.borderRadius = '50px';
    recordButton.style.cursor = 'pointer';
    recordButton.style.display = 'flex';
    recordButton.style.alignItems = 'center';
    recordButton.style.justifyContent = 'center';
    recordButton.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
    recordButton.style.userSelect = 'none';
    recordButton.style.transition = 'all 0.2s ease';
    recordButton.style.zIndex = '1000';
    
    // モバイル向けに最適化
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
        recordButton.style.width = '80%';
        recordButton.style.maxWidth = '300px';
        recordButton.style.bottom = '15px';
        recordButton.style.padding = '12px 20px';
        recordButton.style.fontSize = '16px';
    }
    
    recordButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        if (isConnected && !isListening) {
            handleRecordingStart();
            recordButton.style.backgroundColor = '#e74c3c';
            recordButton.innerHTML = '<div class="recording-indicator"></div> Release to Stop';
        }
    });
    
    recordButton.addEventListener('mouseup', (event) => {
        event.preventDefault();
        if (isConnected && isListening) {
            handleRecordingEnd();
            recordButton.style.backgroundColor = 'var(--primary-color)';
            recordButton.textContent = '🎤 Hold to Speak';
        }
    });
    
    // Add similar behavior for touch devices
    recordButton.addEventListener('touchstart', (event) => {
        event.preventDefault();
        if (isConnected && !isListening) {
            handleRecordingStart();
            recordButton.style.backgroundColor = '#e74c3c';
            recordButton.innerHTML = '<div class="recording-indicator"></div> Release to Stop';
        }
    });
    
    recordButton.addEventListener('touchend', (event) => {
        event.preventDefault();
        if (isConnected && isListening) {
            handleRecordingEnd();
            recordButton.style.backgroundColor = 'var(--primary-color)';
            recordButton.textContent = '🎤 Hold to Speak';
        }
    });
    
    document.body.appendChild(recordButton);
    
    // Function to enumerate audio input devices
    async function enumerateAudioDevices() {
        try {
            // リスト更新前に一時的にユーザーメディアへのアクセスをリクエスト
            // (多くのブラウザではデバイスを列挙する前にメディアアクセス許可が必要)
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            tempStream.getTracks().forEach(track => track.stop());
            
            // デバイスリストを取得
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputDevices = devices.filter(device => device.kind === 'audioinput');
            
            // 一度リストをクリア
            audioDeviceSelect.innerHTML = '';
            
            // デバイスが見つからない場合
            if (audioInputDevices.length === 0) {
                const option = document.createElement('option');
                option.value = '';
                option.text = 'マイクが見つかりません';
                audioDeviceSelect.appendChild(option);
                addLogEntry('利用可能なオーディオ入力デバイスが見つかりません', 'warning');
            } else {
                // 全てのオーディオ入力デバイスをセレクトボックスに追加
                audioInputDevices.forEach(device => {
                    const option = document.createElement('option');
                    option.value = device.deviceId;
                    // デバイス名が空の場合、代替テキストを表示
                    option.text = device.label || `マイク ${audioDeviceSelect.options.length + 1}`;
                    audioDeviceSelect.appendChild(option);
                    
                    // デバイス情報をログに追加
                    addLogEntry(`デバイス検出: ${option.text} (ID: ${device.deviceId.substring(0, 8)}...)`, 'info');
                });
                
                // 前に選択されたデバイスがある場合は再選択
                if (selectedAudioDeviceId) {
                    // デバイスが引き続き存在するか確認
                    const exists = Array.from(audioDeviceSelect.options).some(
                        option => option.value === selectedAudioDeviceId
                    );
                    
                    if (exists) {
                        audioDeviceSelect.value = selectedAudioDeviceId;
                    } else {
                        // 前のデバイスが見つからない場合、最初のデバイスを選択
                        selectedAudioDeviceId = audioDeviceSelect.options[0].value;
                        addLogEntry('前回選択したデバイスが見つからないため、デフォルトデバイスに戻します', 'warning');
                    }
                } else {
                    // 初回は最初のデバイスを選択
                    selectedAudioDeviceId = audioDeviceSelect.options[0].value;
                }
                
                // 選択されたデバイスをハイライト
                audioDeviceSelect.value = selectedAudioDeviceId;
                addLogEntry(`選択されたデバイス: ${audioDeviceSelect.options[audioDeviceSelect.selectedIndex].text}`, 'success');
            }
        } catch (error) {
            addLogEntry(`オーディオデバイスの列挙中にエラーが発生しました: ${error.message}`, 'error');
            // エラーの場合、エラーメッセージを含むオプションを追加
            audioDeviceSelect.innerHTML = '';
            const option = document.createElement('option');
            option.value = '';
            option.text = 'デバイスアクセスエラー';
            audioDeviceSelect.appendChild(option);
        }
    }
    
    // デバイス選択イベントリスナー
    audioDeviceSelect.addEventListener('change', () => {
        selectedAudioDeviceId = audioDeviceSelect.value;
        const selectedDeviceName = audioDeviceSelect.options[audioDeviceSelect.selectedIndex].text;
        addLogEntry(`オーディオデバイスを変更しました: ${selectedDeviceName}`, 'info');
        
        // 現在接続中で録音中でない場合、新しいデバイスで接続を更新
        if (isConnected && !isListening && selectedAudioDeviceId) {
            addLogEntry('新しいオーディオデバイスを適用するには会話を再開始してください', 'info');
        }
    });
    
    // デバイス更新ボタンのイベントリスナー
    refreshDevicesBtn.addEventListener('click', () => {
        addLogEntry('オーディオデバイスリストを更新しています...', 'info');
        enumerateAudioDevices();
    });
    
    // 初期デバイスリストの取得
    enumerateAudioDevices();
    
    // Display initial welcome message
    addLogEntry('Welcome to AI Voice Chat! Click "Start Conversation" to begin.', 'info');
    
    // Initialize static demo waveform for preview
    initStaticDemoWaveform();
    
    // Set up audio analysis for waveform visualization
    function setupAudioAnalysis(stream) {
        try {
            // Check if canvas exists
            if (!waveformCanvas || !waveformCtx) {
                addLogEntry('Waveform canvas not available', 'warning');
                return;
            }
            
            // Create audio context if it doesn't exist
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            // Create analyzer if needed
            if (!analyser) {
                analyser = audioContext.createAnalyser();
                analyser.fftSize = 256;
                const bufferLength = analyser.frequencyBinCount;
                dataArray = new Uint8Array(bufferLength);
            }
            
            // Connect stream to analyzer
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            
            // Initialize waveform canvas
            initWaveformCanvas();
            
            addLogEntry('Audio analysis setup complete', 'success');
        } catch (error) {
            console.error('Audio analysis error:', error);
            addLogEntry(`Error setting up audio analysis: ${error.message}`, 'error');
        }
    }
    
    // Initialize waveform canvas
    function initWaveformCanvas() {
        try {
            // Verify canvas and context are available
            if (!waveformCanvas || !waveformCtx) {
                console.error('Canvas or context is not available');
                return;
            }

            // Make sure canvas dimensions match CSS with fallbacks
            try {
                const canvasRect = waveformCanvas.getBoundingClientRect();
                // Use fallback values if needed
                waveformCanvas.width = canvasRect.width > 0 ? canvasRect.width : 800;
                waveformCanvas.height = canvasRect.height > 0 ? canvasRect.height : 100;
            } catch (e) {
                console.warn('Error getting canvas dimensions, using defaults:', e);
                waveformCanvas.width = 800;
                waveformCanvas.height = 100;
            }
            
            // Clear canvas
            waveformCtx.fillStyle = '#f5f5f5';
            waveformCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
            
            // Draw center line
            waveformCtx.lineWidth = 1;
            waveformCtx.strokeStyle = '#ddd';
            waveformCtx.beginPath();
            waveformCtx.moveTo(0, waveformCanvas.height / 2);
            waveformCtx.lineTo(waveformCanvas.width, waveformCanvas.height / 2);
            waveformCtx.stroke();
            
            console.log('Waveform canvas initialized successfully');
        } catch (error) {
            console.error('Failed to initialize waveform canvas:', error);
        }
    }
    
    // Start waveform animation
    function startWaveformAnimation() {
        try {
            // Skip if required components aren't available
            if (!analyser || !dataArray || !waveformCanvas || !waveformCtx) {
                console.log('Cannot start waveform animation - required components not available');
                return;
            }
            
            // Stop any existing animation
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            
            function drawWaveform() {
                try {
                    // Request next animation frame
                    animationFrameId = requestAnimationFrame(drawWaveform);
                    
                    // Get waveform data
                    analyser.getByteTimeDomainData(dataArray);
                    
                    // Clear canvas
                    waveformCtx.fillStyle = '#f5f5f5';
                    waveformCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
                    
                    // Draw waveform
                    waveformCtx.lineWidth = 2;
                    waveformCtx.strokeStyle = isListening ? '#f39c12' : '#3498db';
                    waveformCtx.beginPath();
                    
                    const sliceWidth = waveformCanvas.width / dataArray.length;
                    let x = 0;
                    
                    for (let i = 0; i < dataArray.length; i++) {
                        const v = dataArray[i] / 128.0;
                        const y = v * waveformCanvas.height / 2;
                        
                        if (i === 0) {
                            waveformCtx.moveTo(x, y);
                        } else {
                            waveformCtx.lineTo(x, y);
                        }
                        
                        x += sliceWidth;
                    }
                    
                    waveformCtx.lineTo(waveformCanvas.width, waveformCanvas.height / 2);
                    waveformCtx.stroke();
                } catch (e) {
                    console.error('Error in waveform animation:', e);
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                }
            }
            
            // Start animation
            drawWaveform();
        } catch (error) {
            console.error('Failed to start waveform animation:', error);
        }
    }
    
    // Stop waveform animation
    function stopWaveformAnimation() {
        try {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            
            // Draw flat line - only if canvas is available
            if (waveformCtx && waveformCanvas) {
                try {
                    waveformCtx.fillStyle = '#f5f5f5';
                    waveformCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
                    
                    // Draw center line
                    waveformCtx.lineWidth = 1;
                    waveformCtx.strokeStyle = '#ddd';
                    waveformCtx.beginPath();
                    waveformCtx.moveTo(0, waveformCanvas.height / 2);
                    waveformCtx.lineTo(waveformCanvas.width, waveformCanvas.height / 2);
                    waveformCtx.stroke();
                } catch (e) {
                    console.error('Error drawing flat line on canvas:', e);
                }
            }
        } catch (error) {
            console.error('Error stopping waveform animation:', error);
        }
    }
    
    // Initialize a static demo waveform animation that doesn't require microphone permission
    function initStaticDemoWaveform() {
        try {
            if (!waveformCanvas || !waveformCtx) {
                console.log('Canvas not available for demo waveform');
                return;
            }
            
            // Initialize the canvas
            initWaveformCanvas();
            
            // Generate some static demo data
            const demoDataLength = 128;
            const demoData = new Array(demoDataLength);
            
            // Animation variables
            let phase = 0;
            const demoAnimationId = 'demoWaveform';
            let animating = true;
            
            function drawDemoWaveform() {
                if (!animating) return;
                
                // Request next animation frame
                window[demoAnimationId] = requestAnimationFrame(drawDemoWaveform);
                
                // Clear canvas
                waveformCtx.fillStyle = '#f5f5f5';
                waveformCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
                
                // Generate sine wave with some randomness
                phase += 0.05;
                for (let i = 0; i < demoDataLength; i++) {
                    const baseValue = Math.sin(i * 0.05 + phase) * 0.3; // Base sine wave
                    const randomFactor = Math.random() * 0.1 - 0.05; // Small random variations
                    demoData[i] = 128 + (baseValue + randomFactor) * 50; // Scale to 0-255 range, centered at 128
                }
                
                // Draw waveform
                waveformCtx.lineWidth = 2;
                waveformCtx.strokeStyle = '#3498db';
                waveformCtx.beginPath();
                
                const sliceWidth = waveformCanvas.width / demoData.length;
                let x = 0;
                
                for (let i = 0; i < demoData.length; i++) {
                    const v = demoData[i] / 128.0;
                    const y = v * waveformCanvas.height / 2;
                    
                    if (i === 0) {
                        waveformCtx.moveTo(x, y);
                    } else {
                        waveformCtx.lineTo(x, y);
                    }
                    
                    x += sliceWidth;
                }
                
                waveformCtx.lineTo(waveformCanvas.width, waveformCanvas.height / 2);
                waveformCtx.stroke();
            }
            
            // Start the demo animation
            drawDemoWaveform();
            
            // Add a note about the demo
            addLogEntry('入力音声の波形のデモアニメーションを表示しています。実際のマイク入力があれば波形が反応します。', 'info');
        } catch (error) {
            console.error('Error initializing demo waveform:', error);
        }
    }
});
