import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Loader2, Settings, MessageSquare } from 'lucide-react';

const CopilotDirectLineChat = () => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [token, setToken] = useState('');
  const [watermark, setWatermark] = useState('');
  const [backendUrl, setBackendUrl] = useState('http://localhost:3001');
  const messagesEndRef = useRef(null);
  const pollIntervalRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    // Simple auto-scroll to bottom for new messages
    const timeoutId = setTimeout(() => {
      scrollToBottom();
    }, 100);
    
    return () => clearTimeout(timeoutId);
  }, [messages]);

  // Initialize Direct Line connection with proper token generation
  const initializeDirectLine = async () => {
    setIsLoading(true);
    try {
      // Check if backend is running
      console.log('🔍 Checking backend health...');
      const healthResponse = await fetch(`${backendUrl}/api/health`);
      if (!healthResponse.ok) {
        throw new Error('Backend server is not running. Please start the backend server first.');
      }
      console.log('✅ Backend is healthy');

      // Step 1: Generate a token using the secret
      console.log('🔑 Generating Direct Line token...');
      const tokenResponse = await fetch(`${backendUrl}/api/directline/tokens/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('❌ Token generation failed:', errorText);
        throw new Error(`Token generation failed: ${tokenResponse.status} - ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      console.log('🔑 Token response:', tokenData);
      
      if (!tokenData.token) {
        throw new Error('No token received from server');
      }
      
      const generatedToken = tokenData.token;
      setToken(generatedToken);
      console.log('✅ Token generated successfully');

      // Step 2: Start conversation using the generated token
      console.log('🔄 Starting conversation with token...');
      const conversationResponse = await fetch(`${backendUrl}/api/directline/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token: generatedToken
        })
      });

      if (!conversationResponse.ok) {
        const errorText = await conversationResponse.text();
        console.error('❌ Conversation creation failed:', errorText);
        throw new Error(`Conversation creation failed: ${conversationResponse.status} - ${errorText}`);
      }

      const conversationData = await conversationResponse.json();
      console.log('🔄 Conversation response:', conversationData);
      
      setConversationId(conversationData.conversationId);
      setIsConnected(true);
      
      // Start polling for messages
      startPolling(conversationData.conversationId);
      
      setMessages([{
        id: Date.now(),
        text: 'Connected to Copilot! You can now start chatting.',
        sender: 'system',
        timestamp: new Date()
      }]);
      
      console.log('🎉 Successfully connected to Copilot!');
      
    } catch (error) {
      console.error('❌ Failed to initialize Direct Line:', error);
      setMessages([{
        id: Date.now(),
        text: `Failed to connect: ${error.message}`,
        sender: 'system',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Start polling for new messages
  const startPolling = (convId) => {
    pollIntervalRef.current = setInterval(() => {
      pollMessages(convId);
    }, 1000);
  };

  // Poll for new messages
  const pollMessages = async (convId) => {
    try {
      const url = `${backendUrl}/api/directline/conversations/${convId}/activities`;
      const params = watermark ? `?watermark=${watermark}` : '';
      
      const response = await fetch(url + params);

      if (!response.ok) return;

      const data = await response.json();
      
      if (data.watermark) {
        setWatermark(data.watermark);
      }

      // Process new activities - filter out echo messages and user messages
      const newMessages = data.activities
        .filter(activity => {
          // Only include bot messages (not user messages or echoes)
          if (activity.type !== 'message') return false;
          if (activity.from.id === 'user') return false; // Skip user messages (echoes)
          if (activity.from.name === 'User') return false; // Skip user name echoes
          
          // Skip messages that are just echoing what the user said
          const currentUserMessages = messages.filter(m => m.sender === 'user').map(m => m.text);
          if (currentUserMessages.includes(activity.text)) return false;
          
          return true; // Include actual bot responses
        })
        .map(activity => ({
          id: activity.id,
          text: activity.text || 'No text content',
          sender: 'bot',
          timestamp: new Date(activity.timestamp),
          attachments: activity.attachments || []
        }));

      if (newMessages.length > 0) {
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const filteredNew = newMessages.filter(m => !existingIds.has(m.id));
          return [...prev, ...filteredNew];
        });
      }
    } catch (error) {
      console.error('Error polling messages:', error);
    }
  };

  // Send message to bot
  const sendMessage = async () => {
    if (!inputMessage.trim() || !isConnected) return;

    const userMessage = {
      id: `user-${Date.now()}`,
      text: inputMessage,
      sender: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      const response = await fetch(`${backendUrl}/api/directline/conversations/${conversationId}/activities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'message',
          from: { id: 'user', name: 'User' },
          text: inputMessage
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to send message: ${response.status}`);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, {
        id: Date.now(),
        text: `Error sending message: ${error.message}`,
        sender: 'system',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Disconnect from Direct Line
  const disconnect = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    setIsConnected(false);
    setConversationId('');
    setToken('');
    setWatermark('');
    setMessages([]);
  };

  // Handle Enter key press
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isConnected) {
        sendMessage();
      } else {
        initializeDirectLine();
      }
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-96">
        
        {/* LEFT PANEL - Chat Section */}
        <div className="lg:col-span-2 flex flex-col">
          {/* Chat Header */}
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-blue-600" />
              <h2 className="text-xl font-bold text-gray-800">Chat with Copilot</h2>
            </div>
            
            {isConnected && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-green-600">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm">Connected</span>
                </div>
                <button
                  onClick={disconnect}
                  className="px-3 py-1 text-sm bg-red-500 text-white rounded-md hover:bg-red-600"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>

          {/* Messages Container - Scrollable */}
          <div className="flex-1 border border-gray-200 rounded-lg overflow-y-auto bg-gray-50 p-4 mb-4">
            {messages.length === 0 && !isConnected && (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                <Bot className="w-12 h-12 mb-4 text-gray-400" />
                <p>Configure your connection in the panel on the right,</p>
                <p>then click "Connect to Copilot" to start chatting</p>
              </div>
            )}
            
            {messages.map((message) => (
              <div key={message.id} className={`mb-4 flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex items-start gap-2 max-w-xs lg:max-w-md ${message.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    message.sender === 'user' 
                      ? 'bg-blue-500 text-white' 
                      : message.sender === 'bot'
                      ? 'bg-purple-500 text-white'
                      : 'bg-gray-500 text-white'
                  }`}>
                    {message.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>
                  
                  <div className={`px-3 py-2 rounded-lg ${
                    message.sender === 'user'
                      ? 'bg-blue-500 text-white'
                      : message.sender === 'bot'
                      ? 'bg-white text-gray-800 border'
                      : 'bg-gray-200 text-gray-700'
                  }`}>
                    <div className="text-sm">{message.text}</div>
                    <div className={`text-xs mt-1 opacity-70 ${
                      message.sender === 'user' ? 'text-blue-100' : 'text-gray-500'
                    }`}>
                      {message.timestamp.toLocaleTimeString()}
                    </div>
                    
                    {/* Handle attachments */}
                    {message.attachments && message.attachments.length > 0 && (
                      <div className="mt-2">
                        {message.attachments.map((attachment, index) => (
                          <div key={index} className="text-xs text-blue-600">
                            {attachment.contentType === 'image/png' || attachment.contentType === 'image/jpeg' ? (
                              <img src={attachment.contentUrl} alt="Attachment" className="max-w-full h-auto mt-1 rounded" />
                            ) : (
                              <a href={attachment.contentUrl} target="_blank" rel="noopener noreferrer">
                                📎 {attachment.name || 'Attachment'}
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="flex gap-2">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={isConnected ? "Type your message..." : "Connect first using the panel on the right"}
              disabled={!isConnected || isLoading}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
            <button
              onClick={sendMessage}
              disabled={!isConnected || isLoading || !inputMessage.trim()}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* RIGHT PANEL - Configuration & Instructions */}
        <div className="lg:col-span-1 flex flex-col">
          {/* Configuration Header */}
          <div className="flex items-center gap-2 mb-4 pb-4 border-b border-gray-200">
            <Settings className="w-5 h-5 text-gray-600" />
            <h2 className="text-xl font-bold text-gray-800">Configuration</h2>
          </div>

          {/* Connection Configuration */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Backend Server URL:
            </label>
            <input
              type="text"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              placeholder="http://localhost:3001"
              disabled={isConnected}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
            
            <button
              onClick={initializeDirectLine}
              disabled={isLoading || !backendUrl || isConnected}
              className="w-full mt-3 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting...
                </>
              ) : isConnected ? (
                'Connected'
              ) : (
                'Connect to Copilot'
              )}
            </button>
          </div>

          {/* Instructions Section */}
          <div className="flex-1 overflow-y-auto">
            <h3 className="font-semibold mb-3 text-gray-800">Setup Instructions:</h3>
            <div className="text-sm text-gray-600 space-y-3">
              <div className="bg-blue-50 p-3 rounded-lg">
                <h4 className="font-semibold text-blue-800 mb-2">📋 Quick Setup:</h4>
                <ol className="list-decimal list-inside space-y-1 text-blue-700">
                  <li>Create Azure Bot Service</li>
                  <li>Enable Direct Line channel</li>
                  <li>Copy the secret key</li>
                  <li>Add to <code className="bg-blue-200 px-1 rounded">backend/.env</code></li>
                  <li>Start backend: <code className="bg-blue-200 px-1 rounded">npm run dev</code></li>
                  <li>Click "Connect to Copilot" above</li>
                </ol>
              </div>

              <div className="bg-green-50 p-3 rounded-lg">
                <h4 className="font-semibold text-green-800 mb-2">✅ Features:</h4>
                <ul className="list-disc list-inside space-y-1 text-green-700">
                  <li>Secure token-based authentication</li>
                  <li>Real-time message polling</li>
                  <li>CORS-free backend proxy</li>
                  <li>Attachment support</li>
                  <li>Auto-reconnection</li>
                </ul>
              </div>

              <div className="bg-yellow-50 p-3 rounded-lg">
                <h4 className="font-semibold text-yellow-800 mb-2">🔧 Environment Setup:</h4>
                <pre className="text-xs bg-gray-800 text-green-400 p-2 rounded mt-2">
{`# backend/.env
DIRECTLINE_SECRET=your_key_here
PORT=3001`}
                </pre>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg">
                <h4 className="font-semibold text-gray-800 mb-2">🛠️ Troubleshooting:</h4>
                <ul className="list-disc list-inside space-y-1 text-gray-700 text-xs">
                  <li>Backend health: <code className="bg-gray-200 px-1">/api/health</code></li>
                  <li>Check console for errors</li>
                  <li>Verify Direct Line secret</li>
                  <li>Ensure both services are running</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CopilotDirectLineChat;