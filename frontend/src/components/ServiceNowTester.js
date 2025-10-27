import React, { useState, useRef, useEffect } from 'react';
import { Send, RefreshCw, CheckCircle, XCircle, MessageSquare, Bug } from 'lucide-react';

const ServiceNowTester = () => {
  const [config, setConfig] = useState({
    baseUrl: 'https://dev205527.service-now.com',
    username: 'admin',
    password: '',
    token: 'TGbK5XRDgtmf4rK',
    topicId: 'ce2ee85053130010cf8cddeeff7b12bf'
  });

  const [conversationState, setConversationState] = useState({
    chatSessionId: null,
    isConnected: false
  });

  const [message, setMessage] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastResponse, setLastResponse] = useState(null);
  const [lastRequest, setLastRequest] = useState(null);
  const [error, setError] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [pollingInterval, setPollingInterval] = useState(5000);
  const [debugLogs, setDebugLogs] = useState([]);
  const [showDebug, setShowDebug] = useState(true);
  const pollIntervalRef = useRef(null);
  const processedMessageIds = useRef(new Set());

  // Add debug log
  const addDebugLog = (message, type = 'info') => {
    const log = {
      timestamp: new Date().toISOString(),
      message,
      type
    };
    setDebugLogs(prev => [log, ...prev].slice(0, 100));
    console.log(`[${type.toUpperCase()}]`, message);
  };

  // Generate unique IDs
  const generateRequestId = () => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const generateClientMessageId = () => {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  // Extract chatSessionId from response body array
  const extractChatSessionId = (responseBody) => {
    if (!Array.isArray(responseBody)) return null;
    
    // Look for SubscribeToChatPresence action which contains chatSessionId
    const chatPresenceAction = responseBody.find(
      item => item.uiType === 'ActionMsg' && item.actionType === 'SubscribeToChatPresence'
    );
    
    if (chatPresenceAction?.chatSessionId) {
      return chatPresenceAction.chatSessionId;
    }
    
    // Alternative: Look for StartConversation action which has conversationId
    const startConversationAction = responseBody.find(
      item => item.uiType === 'ActionMsg' && item.actionType === 'StartConversation'
    );
    
    if (startConversationAction?.conversationId) {
      return startConversationAction.conversationId;
    }
    
    return null;
  };

  // Fetch messages from ServiceNow
  const fetchMessages = async () => {
    if (!conversationState.chatSessionId) {
      addDebugLog('⚠️ No chatSessionId - skipping poll', 'warn');
      return;
    }

    addDebugLog(`🔄 Polling conversation: ${conversationState.chatSessionId}`, 'info');

    try {
      const response = await fetch('http://localhost:3001/api/servicenow/get-messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          serviceNowUrl: config.baseUrl,
          username: config.username,
          password: config.password,
          conversationId: conversationState.chatSessionId,
          limit: 100
        })
      });

      addDebugLog(`📥 Poll response: ${response.status}`, 'info');

      if (!response.ok) {
        const errorData = await response.json();
        addDebugLog(`❌ Poll error: ${JSON.stringify(errorData)}`, 'error');
        return;
      }

      const data = await response.json();
      addDebugLog(`📊 Messages returned: ${data.result?.length || 0}`, 'info');

      if (data.result && data.result.length > 0) {
        // Log all messages
        data.result.forEach((msg, index) => {
          addDebugLog(`📝 Msg ${index + 1}: sys_id=${msg.sys_id}, is_agent=${msg.is_agent}, payload="${msg.payload?.substring(0, 50)}..."`, 'debug');
        });

        // Filter for new agent messages
        const newAgentMessages = data.result.filter(msg => {
          const isNew = !processedMessageIds.current.has(msg.sys_id);
          const isAgent = msg.is_agent === 'true' || msg.is_agent === true;
          const hasPayload = msg.payload && msg.payload.trim().length > 0;
          return isNew && isAgent && hasPayload;
        });

        addDebugLog(`✅ New agent messages: ${newAgentMessages.length}`, newAgentMessages.length > 0 ? 'success' : 'info');

        newAgentMessages.forEach(agentMsg => {
          processedMessageIds.current.add(agentMsg.sys_id);
          addDebugLog(`💬 Agent: "${agentMsg.payload}"`, 'success');
          
          setChatHistory(prev => [...prev, {
            type: 'received',
            text: agentMsg.payload,
            timestamp: new Date(agentMsg.send_time || Date.now()),
            sysId: agentMsg.sys_id,
            isAgent: true,
            agentName: agentMsg.sys_created_by || 'Live Agent'
          }]);
        });
      }
    } catch (err) {
      addDebugLog(`❌ Fetch error: ${err.message}`, 'error');
    }
  };

  // Start polling
  const startPolling = () => {
    if (isPolling) return;
    if (!conversationState.chatSessionId) {
      addDebugLog('❌ Cannot poll: no chatSessionId', 'error');
      return;
    }
    
    setIsPolling(true);
    addDebugLog(`🚀 Polling started (${pollingInterval}ms)`, 'success');
    
    fetchMessages(); // Immediate first poll
    
    pollIntervalRef.current = setInterval(() => {
      fetchMessages();
    }, pollingInterval);
  };

  // Stop polling
  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsPolling(false);
    addDebugLog('⏹️ Polling stopped', 'info');
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  // Initiate new conversation with "Copilot Handoff Test"
  const initiateConversation = async () => {
    setIsLoading(true);
    setError(null);

    const requestId = generateRequestId();
    const clientMessageId = generateClientMessageId();

    // FIRST CALL: Send with "Copilot Handoff Test" message
    const payload = {
      requestId: requestId,
      enterpriseId: "ServiceNow",
      nowBotId: null,
      nowSessionId: null,
      topic: config.topicId,
      clientVariables: {},
      message: {
        text: "Copilot Handoff Test",
        typed: false,
        clientMessageId: clientMessageId,
        attachment: null
      },
      timestamp: Math.floor(Date.now() / 1000),
      botToBot: true,
      silentMessage: null,
      intent: null,
      contextVariables: {},
      userId: config.username,
      emailId: `${config.username}@example.com`
    };

    setLastRequest(payload);
    addDebugLog('🚀 Initiating NEW conversation with "Copilot Handoff Test"', 'info');
    addDebugLog(`📋 Payload: ${JSON.stringify(payload, null, 2)}`, 'debug');

    try {
      const response = await fetch('http://localhost:3001/api/servicenow/bot/integration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          serviceNowUrl: config.baseUrl,
          username: config.username,
          password: config.password,
          token: config.token,
          payload: payload
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setLastResponse(data);
      addDebugLog(`📥 Response: ${JSON.stringify(data, null, 2)}`, 'debug');

      // Extract chatSessionId from response body array
      const chatSessionId = extractChatSessionId(data.body);
      
      if (chatSessionId) {
        addDebugLog(`🔑 Chat Session ID: ${chatSessionId}`, 'success');
        
        setConversationState({
          chatSessionId: chatSessionId,
          isConnected: true
        });

        // Add system message
        setChatHistory([{
          type: 'system',
          text: `✅ Connected to ServiceNow Live Agent (Session: ${chatSessionId})`,
          timestamp: new Date(),
          isSystem: true
        }]);

        // Extract bot messages from response
        if (Array.isArray(data.body)) {
          const outputTexts = data.body
            .filter(item => item.uiType === 'OutputText' && item.value)
            .map(item => item.value);
          
          if (outputTexts.length > 0) {
            outputTexts.forEach(text => {
              setChatHistory(prev => [...prev, {
                type: 'received',
                text: text,
                timestamp: new Date(),
                isBot: true
              }]);
            });
          }
        }

        // Start polling after 2 seconds
        addDebugLog('🔄 Will start polling in 2 seconds...', 'info');
        setTimeout(() => startPolling(), 2000);

      } else {
        addDebugLog('⚠️ No chatSessionId in response!', 'warn');
        addDebugLog(`Response body: ${JSON.stringify(data.body)}`, 'debug');
      }

    } catch (err) {
      addDebugLog(`❌ Error: ${err.message}`, 'error');
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Send follow-up message
  const sendMessage = async () => {
    if (!message.trim()) {
      addDebugLog('⚠️ Cannot send empty message', 'warn');
      return;
    }

    if (!conversationState.chatSessionId) {
      addDebugLog('❌ Not connected. Please initiate conversation first.', 'error');
      return;
    }

    setIsLoading(true);
    setError(null);

    const requestId = generateRequestId();
    const clientMessageId = generateClientMessageId();

    // FOLLOW-UP MESSAGE: Use nowSessionId (which is the chatSessionId)
    const payload = {
      requestId: requestId,
      enterpriseId: "ServiceNow",
      nowBotId: null,
      nowSessionId: conversationState.chatSessionId, // Use chatSessionId as nowSessionId
      clientVariables: {},
      message: {
        text: message,
        typed: true,
        clientMessageId: clientMessageId,
        attachment: null
      },
      timestamp: Math.floor(Date.now() / 1000),
      botToBot: true,
      silentMessage: null,
      intent: null,
      contextVariables: {},
      userId: config.username,
      emailId: `${config.username}@example.com`
    };

    setLastRequest(payload);
    addDebugLog(`📤 Sending message: "${message}"`, 'info');
    addDebugLog(`📋 Payload: ${JSON.stringify(payload, null, 2)}`, 'debug');

    // Add user message to UI
    const userMessage = {
      type: 'sent',
      text: message,
      timestamp: new Date()
    };
    setChatHistory(prev => [...prev, userMessage]);
    setMessage('');

    try {
      const response = await fetch('http://localhost:3001/api/servicenow/bot/integration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          serviceNowUrl: config.baseUrl,
          username: config.username,
          password: config.password,
          token: config.token,
          payload: payload
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setLastResponse(data);
      addDebugLog(`📥 Response: ${JSON.stringify(data)}`, 'debug');

      if (data.status === 'success') {
        addDebugLog('✅ Message sent successfully', 'success');
      }

    } catch (err) {
      addDebugLog(`❌ Error: ${err.message}`, 'error');
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Reset everything
  const resetConversation = () => {
    addDebugLog('🔄 Resetting - will start fresh', 'info');
    stopPolling();
    processedMessageIds.current.clear();
    setConversationState({
      chatSessionId: null,
      isConnected: false
    });
    setChatHistory([]);
    setLastResponse(null);
    setLastRequest(null);
    setError(null);
    setMessage('');
    addDebugLog('✅ Reset complete', 'success');
  };

  return (
    <div className="max-w-7xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT PANEL - Configuration */}
        <div className="lg:col-span-1">
          <div className="flex items-center gap-2 mb-4 pb-4 border-b">
            <MessageSquare className="w-5 h-5 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-800">ServiceNow Config</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ServiceNow URL:
              </label>
              <input
                type="text"
                value={config.baseUrl}
                onChange={(e) => setConfig({...config, baseUrl: e.target.value})}
                disabled={conversationState.isConnected}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm disabled:bg-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username:
              </label>
              <input
                type="text"
                value={config.username}
                onChange={(e) => setConfig({...config, username: e.target.value})}
                disabled={conversationState.isConnected}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm disabled:bg-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password:
              </label>
              <input
                type="password"
                value={config.password}
                onChange={(e) => setConfig({...config, password: e.target.value})}
                disabled={conversationState.isConnected}
                placeholder="Enter password"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm disabled:bg-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Token:
              </label>
              <input
                type="text"
                value={config.token}
                onChange={(e) => setConfig({...config, token: e.target.value})}
                disabled={conversationState.isConnected}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm disabled:bg-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Topic ID:
              </label>
              <input
                type="text"
                value={config.topicId}
                onChange={(e) => setConfig({...config, topicId: e.target.value})}
                disabled={conversationState.isConnected}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm disabled:bg-gray-100"
              />
            </div>

            {/* Connection Status */}
            {conversationState.isConnected && (
              <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                <h3 className="font-semibold text-green-800 text-sm mb-2">
                  ✅ Connected to Live Agent
                </h3>
                <div className="text-xs text-green-700 space-y-1">
                  <div><strong>Chat Session:</strong> {conversationState.chatSessionId}</div>
                </div>
              </div>
            )}

            {/* Polling Controls */}
            {conversationState.chatSessionId && (
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                <h3 className="font-semibold text-blue-800 text-sm mb-2">Message Polling:</h3>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2 h-2 rounded-full ${isPolling ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
                  <span className="text-xs text-blue-700">
                    {isPolling ? 'Active' : 'Stopped'}
                  </span>
                </div>
                <div className="flex gap-2 mb-2">
                  {!isPolling ? (
                    <button
                      onClick={startPolling}
                      className="flex-1 px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                    >
                      Start
                    </button>
                  ) : (
                    <button
                      onClick={stopPolling}
                      className="flex-1 px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                    >
                      Stop
                    </button>
                  )}
                  <button
                    onClick={fetchMessages}
                    disabled={!conversationState.chatSessionId}
                    className="flex-1 px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                  >
                    Poll Now
                  </button>
                </div>
                <div>
                  <label className="text-xs text-blue-700">Interval (ms):</label>
                  <input
                    type="number"
                    value={pollingInterval}
                    onChange={(e) => setPollingInterval(parseInt(e.target.value) || 5000)}
                    className="w-full px-2 py-1 text-xs border border-blue-300 rounded mt-1"
                    disabled={isPolling}
                  />
                </div>
              </div>
            )}

            {/* Action Buttons */}
            {!conversationState.isConnected ? (
              <button
                onClick={initiateConversation}
                disabled={isLoading || !config.password}
                className="w-full px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-semibold"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Connect to Live Agent
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={resetConversation}
                className="w-full px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Reset & New Conversation
              </button>
            )}
          </div>
        </div>

        {/* RIGHT PANEL - Chat and Debug */}
        <div className="lg:col-span-2 flex flex-col">
          <div className="flex items-center justify-between mb-4 pb-4 border-b">
            <h2 className="text-xl font-bold text-gray-800">ServiceNow Chat</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowDebug(!showDebug)}
                className="flex items-center gap-1 px-3 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600"
              >
                <Bug className="w-3 h-3" />
                {showDebug ? 'Hide' : 'Show'} Debug
              </button>
              {conversationState.isConnected ? (
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <CheckCircle className="w-4 h-4" />
                  Connected
                </div>
              ) : (
                <div className="flex items-center gap-2 text-gray-600 text-sm">
                  <XCircle className="w-4 h-4" />
                  Not Connected
                </div>
              )}
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Debug Logs */}
          {showDebug && (
            <div className="mb-4 p-3 bg-gray-900 text-green-400 rounded-lg max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm text-white">Debug Console</h3>
                <button
                  onClick={() => setDebugLogs([])}
                  className="text-xs bg-gray-700 px-2 py-1 rounded hover:bg-gray-600"
                >
                  Clear
                </button>
              </div>
              <div className="text-xs font-mono space-y-1">
                {debugLogs.length === 0 ? (
                  <div className="text-gray-500">No logs yet...</div>
                ) : (
                  debugLogs.map((log, index) => (
                    <div key={index} className={`${
                      log.type === 'error' ? 'text-red-400' :
                      log.type === 'warn' ? 'text-yellow-400' :
                      log.type === 'success' ? 'text-green-400' :
                      log.type === 'debug' ? 'text-blue-400' :
                      'text-gray-300'
                    }`}>
                      [{new Date(log.timestamp).toLocaleTimeString()}] {log.message}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Chat History */}
          <div className="flex-1 border border-gray-200 rounded-lg overflow-y-auto bg-gray-50 p-4 mb-4 min-h-64 max-h-80">
            {chatHistory.length === 0 ? (
              <div className="text-center text-gray-500 mt-20">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>Click "Connect to Live Agent" to start</p>
              </div>
            ) : (
              chatHistory.map((msg, index) => (
                <div key={index} className={`mb-4 ${msg.isSystem ? 'text-center' : msg.type === 'sent' ? 'text-right' : 'text-left'}`}>
                  {msg.isSystem ? (
                    <div className="inline-block px-4 py-2 bg-blue-100 border border-blue-300 rounded-lg text-blue-800 text-sm">
                      {msg.text}
                    </div>
                  ) : (
                    <div className={`inline-block max-w-md px-4 py-2 rounded-lg ${
                      msg.type === 'sent' 
                        ? 'bg-blue-500 text-white' 
                        : msg.isAgent
                        ? 'bg-purple-100 border-2 border-purple-400 text-gray-800'
                        : msg.isBot
                        ? 'bg-green-100 border border-green-300 text-gray-800'
                        : 'bg-white border border-gray-300 text-gray-800'
                    }`}>
                      {msg.isAgent && (
                        <div className="text-xs font-semibold text-purple-700 mb-1">
                          👤 {msg.agentName || 'Live Agent'}
                        </div>
                      )}
                      {msg.isBot && (
                        <div className="text-xs font-semibold text-green-700 mb-1">
                          🤖 ServiceNow Bot
                        </div>
                      )}
                      <div className="text-sm">{msg.text}</div>
                      <div className={`text-xs mt-1 ${
                        msg.type === 'sent' ? 'text-blue-100' : 'text-gray-500'
                      }`}>
                        {msg.timestamp.toLocaleTimeString()}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Message Input */}
          {conversationState.isConnected && (
            <div className="mb-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !isLoading && sendMessage()}
                  placeholder="Type your message..."
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                />
                <button
                  onClick={sendMessage}
                  disabled={isLoading || !message.trim()}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isLoading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ServiceNowTester;