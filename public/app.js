// DOM Elements
const voiceSelect = document.getElementById('voice-select');
const audioDeviceSelect = document.getElementById('audio-device-select');
const refreshDevicesBtn = document.getElementById('refresh-devices-btn');
const statusLight = document.getElementById('status-light');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const conversationEl = document.getElementById('conversation');
const logEl = document.getElementById('log');
const waveformCanvas = document.getElementById('waveform-canvas');

// Global variables
let peerConnection = null;
let dataChannel = null;
let mediaStream = null;
let audioContext = null;
let analyser = null;
let animationFrameId = null;
let conversationStartTime = null;
let lastUserMessageTime = null;
let lastAIMessageTime = null;
let selectedVoice = voiceSelect.value;
let isConnected = false;
let isListening = false;

// Canvas context for waveform visualization
const canvasCtx = waveformCanvas.getContext('2d');

// Logger function
function logMessage(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${timestamp}] ${message}`;
    logEl.appendChild(logEntry);
    logEl.scrollTop = logEl.scrollHeight;
    
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// Update connection status UI
function updateStatus(status) {
    switch(status) {
        case 'disconnected':
            statusLight.className = 'status-light disconnected';
            statusText.textContent = 'Disconnected';
            startBtn.disabled = false;
            stopBtn.disabled = true;
            isConnected = false;
            isListening = false;
            break;
        case 'connecting':
            statusLight.className = 'status-light disconnected';
            statusText.textContent = 'Connecting...';
            startBtn.disabled = true;
            stopBtn.disabled = false;
            isConnected = false;
            isListening = false;
            break;
        case 'connected':
            statusLight.className = 'status-light connected';
            statusText.textContent = 'Connected';
            startBtn.disabled = true;
            stopBtn.disabled = false;
            isConnected = true;
            isListening = false;
            break;
        case 'listening':
            statusLight.className = 'status-light listening';
            statusText.textContent = 'Listening...';
            startBtn.disabled = true;
            stopBtn.disabled = false;
            isConnected = true;
            isListening = true;
            break;
        case 'processing':
            statusLight.className = 'status-light connected';
            statusText.textContent = 'Processing...';
            startBtn.disabled = true;
            stopBtn.disabled = false;
            isConnected = true;
            isListening = false;
            break;
    }
}

// Add message to conversation
function addMessage(text, sender, metadata = {}) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${sender}`;
    messageEl.textContent = text;
    
    const metaEl = document.createElement('div');
    metaEl.className = 'message-meta';
    
    // Add timestamp
    const timestamp = new Date().toLocaleTimeString();
    metaEl.textContent = `${timestamp}`;
    
    // Add duration if available
    if (metadata.duration) {
        metaEl.textContent += ` (${metadata.duration.toFixed(2)}s)`;
    }
    
    // Add message ID if available
    if (metadata.id) {
        metaEl.textContent += ` | ID: ${metadata.id}`;
    }
    
    messageEl.appendChild(metaEl);
    conversationEl.appendChild(messageEl);
    conversationEl.scrollTop = conversationEl.scrollHeight;
    
    // Update timing information
    if (sender === 'user') {
        lastUserMessageTime = new Date();
    } else if (sender === 'ai') {
        lastAIMessageTime = new Date();
        
        // Calculate response time if we have both message times
        if (lastUserMessageTime) {
            const responseTime = (lastAIMessageTime - lastUserMessageTime) / 1000;
            logMessage(`AI response time: ${responseTime.toFixed(2)}s`, 'info');
        }
    }
}

// Initialize audio devices
async function initAudioDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputDevices = devices.filter(device => device.kind === 'audioinput');
        
        // Clear existing options
        audioDeviceSelect.innerHTML = '';
        
        // Add devices to select
        audioInputDevices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Microphone ${audioDeviceSelect.options.length + 1}`;
            audioDeviceSelect.appendChild(option);
        });
        
        logMessage(`Found ${audioInputDevices.length} audio input devices`, 'info');
    } catch (error) {
        logMessage(`Error enumerating audio devices: ${error.message}`, 'error');
    }
}

// Start audio visualization
function startVisualization() {
    if (!mediaStream || !audioContext) return;
    
    // Create analyzer if it doesn't exist
    if (!analyser) {
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        
        const source = audioContext.createMediaStreamSource(mediaStream);
        source.connect(analyser);
    }
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Clear the canvas
    canvasCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    
    // Draw function for visualization
    function draw() {
        animationFrameId = requestAnimationFrame(draw);
        
        analyser.getByteTimeDomainData(dataArray);
        
        canvasCtx.fillStyle = 'rgb(248, 249, 250)';
        canvasCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
        
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeStyle = isListening ? 'rgb(40, 167, 69)' : 'rgb(74, 111, 165)';
        canvasCtx.beginPath();
        
        const sliceWidth = waveformCanvas.width / bufferLength;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = v * waveformCanvas.height / 2;
            
            if (i === 0) {
                canvasCtx.moveTo(x, y);
            } else {
                canvasCtx.lineTo(x, y);
            }
            
            x += sliceWidth;
        }
        
        canvasCtx.lineTo(waveformCanvas.width, waveformCanvas.height / 2);
        canvasCtx.stroke();
    }
    
    draw();
}

// Stop audio visualization
function stopVisualization() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    // Clear the canvas
    if (canvasCtx) {
        canvasCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
        canvasCtx.fillStyle = 'rgb(248, 249, 250)';
        canvasCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    }
}

// Initialize WebRTC connection
async function initWebRTC() {
    try {
        updateStatus('connecting');
        logMessage('Initializing WebRTC connection...', 'info');
        
        // Get ephemeral key from server
        const tokenResponse = await fetch('/session');
        if (!tokenResponse.ok) {
            throw new Error(`Failed to get session token: ${tokenResponse.status}`);
        }
        
        const data = await tokenResponse.json();
        const EPHEMERAL_KEY = data.client_secret.value;
        logMessage('Received ephemeral key', 'success');
        
        // Create peer connection
        peerConnection = new RTCPeerConnection();
        
        // Set up audio element for remote audio
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        
        // Handle incoming tracks
        peerConnection.ontrack = (event) => {
            logMessage('Received audio track from AI', 'success');
            audioEl.srcObject = event.streams[0];
        };
        
        // Get user media with selected device
        const constraints = {
            audio: {
                deviceId: audioDeviceSelect.value ? { exact: audioDeviceSelect.value } : undefined,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };
        
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        logMessage('Microphone access granted', 'success');
        
        // Create audio context for visualization
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Add local audio track
        mediaStream.getAudioTracks().forEach(track => {
            peerConnection.addTrack(track, mediaStream);
            logMessage(`Added audio track: ${track.label}`, 'info');
        });
        
        // Set up data channel
        dataChannel = peerConnection.createDataChannel('oai-events');
        dataChannel.onopen = () => {
            logMessage('Data channel opened', 'success');
        };
        
        dataChannel.onmessage = handleDataChannelMessage;
        
        // Create offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        logMessage('Created SDP offer', 'info');
        
        // Send offer to server
        const model = 'gpt-4o-mini-realtime-preview-2024-12-17';
        const sdpResponse = await fetch(`/api/realtime/sdp?model=${model}&voice=${selectedVoice}`, {
            method: 'POST',
            body: offer.sdp,
            headers: {
                'Content-Type': 'application/sdp'
            }
        });
        
        if (!sdpResponse.ok) {
            throw new Error(`Failed to get SDP answer: ${sdpResponse.status}`);
        }
        
        const sdpAnswer = await sdpResponse.text();
        logMessage('Received SDP answer', 'success');
        
        // Set remote description
        const answer = {
            type: 'answer',
            sdp: sdpAnswer
        };
        
        await peerConnection.setRemoteDescription(answer);
        logMessage('WebRTC connection established', 'success');
        
        // Start visualization
        startVisualization();
        
        // Update status
        updateStatus('connected');
        conversationStartTime = new Date();
        logMessage(`Conversation started at ${conversationStartTime.toLocaleTimeString()}`, 'info');
        
    } catch (error) {
        logMessage(`Error initializing WebRTC: ${error.message}`, 'error');
        updateStatus('disconnected');
        closeConnection();
    }
}

// Handle data channel messages
function handleDataChannelMessage(event) {
    try {
        const data = JSON.parse(event.data);
        logMessage(`Received event: ${data.type}`, 'info');
        
        switch (data.type) {
            case 'recognition_started':
                updateStatus('listening');
                logMessage('Recognition started', 'info');
                break;
                
            case 'recognition_result':
                if (data.is_final) {
                    updateStatus('processing');
                    const duration = data.duration ? data.duration : 0;
                    addMessage(data.text, 'user', { 
                        duration: duration,
                        id: data.message_id 
                    });
                    logMessage(`User message (${duration.toFixed(2)}s): ${data.text}`, 'info');
                }
                break;
                
            case 'generation_started':
                logMessage('AI response generation started', 'info');
                break;
                
            case 'generation_complete':
                updateStatus('connected');
                if (data.text) {
                    const duration = data.duration ? data.duration : 0;
                    addMessage(data.text, 'ai', { 
                        duration: duration,
                        id: data.message_id 
                    });
                    logMessage(`AI message (${duration.toFixed(2)}s): ${data.text}`, 'info');
                }
                break;
                
            case 'error':
                logMessage(`Error from server: ${data.message}`, 'error');
                break;
                
            default:
                logMessage(`Unknown event type: ${data.type}`, 'warning');
        }
    } catch (error) {
        logMessage(`Error handling data channel message: ${error.message}`, 'error');
    }
}

// Close WebRTC connection
function closeConnection() {
    // Stop tracks
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => {
            track.stop();
            logMessage(`Stopped track: ${track.label}`, 'info');
        });
        mediaStream = null;
    }
    
    // Close data channel
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }
    
    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Close audio context
    if (audioContext) {
        audioContext.close().catch(err => {
            logMessage(`Error closing audio context: ${err.message}`, 'error');
        });
        audioContext = null;
        analyser = null;
    }
    
    // Stop visualization
    stopVisualization();
    
    // Log conversation duration if it was started
    if (conversationStartTime) {
        const endTime = new Date();
        const duration = (endTime - conversationStartTime) / 1000;
        logMessage(`Conversation ended. Duration: ${duration.toFixed(2)}s`, 'info');
        conversationStartTime = null;
    }
    
    updateStatus('disconnected');
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Initialize audio devices
    initAudioDevices();
    
    // Voice selection change
    voiceSelect.addEventListener('change', () => {
        selectedVoice = voiceSelect.value;
        logMessage(`Selected voice: ${selectedVoice}`, 'info');
    });
    
    // Refresh devices button
    refreshDevicesBtn.addEventListener('click', () => {
        logMessage('Refreshing audio devices...', 'info');
        initAudioDevices();
    });
    
    // Start button
    startBtn.addEventListener('click', () => {
        initWebRTC();
    });
    
    // Stop button
    stopBtn.addEventListener('click', () => {
        logMessage('Ending conversation...', 'info');
        closeConnection();
    });
    
    // Handle device changes
    navigator.mediaDevices.addEventListener('devicechange', () => {
        logMessage('Audio devices changed', 'info');
        initAudioDevices();
    });
});

// Handle page unload
window.addEventListener('beforeunload', () => {
    closeConnection();
});

// Log initial app load
logMessage('Voice chat application loaded', 'info');
