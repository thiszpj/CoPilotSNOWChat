import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Loader2, UserCheck, AlertCircle, CheckCircle, Wifi, WifiOff } from 'lucide-react';
import * as signalR from '@microsoft/signalr';
import config from '../config';

const UnifiedChatWithHandoff = () => {
  // Chat state
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Mode: 'none', 'copilot', 'handoff', 'agent'
  const [chatMode, setChatMode] = useState('none');
  const chatModeRef = useRef('none');
  
  // Copilot (Direct Line) state
  const [copilotConversationId, setCopilotConversationId] = useState('');
  const [copilotWatermark, setCopilotWatermark] = useState('');
  const copilotPollIntervalRef = useRef(null);
  
  // ServiceNow state
  const [serviceNowState, setServiceNowState] = useState({
    nowBotId: null,
    nowSessionId: null,
    requestId: null,
    chatSessionId: null
  });
  
  // SignalR state
  const [signalRConnection, setSignalRConnection] = useState(null);
  const [signalRStatus, setSignalRStatus] = useState('disconnected');
  const signalRConnectionRef = useRef(null);
  
  // Session mapping
  const sessionMappingRef = useRef({
    copilotConversationId: null,
    serviceNowChatSessionId: null,
    conversationContext: []
  });
  
  // Configuration
  const [serviceNowConfig, setServiceNowConfig] = useState({
    password: '',
  });
  
  const [showConfig, setShowConfig] = useState(true);
  const messagesEndRef = useRef(null);
  const seenMessageIdsRef = useRef(new Set());

  // Auto-scroll
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      scrollToBottom();
    }, 100);
    return () => clearTimeout(timeoutId);
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (copilotPollIntervalRef.current) {
        clearInterval(copilotPollIntervalRef.current);
      }
      if (signalRConnectionRef.current) {
        signalRConnectionRef.current.stop();
      }
    };
  }, []);

  // ============== SIGNALR FUNCTIONS ==============
  
  const initializeSignalR = async () => {
    try {
      console.log('🔌 Initializing SignalR connection...');
      setSignalRStatus('connecting');
      
      // Get SignalR negotiation info from Azure Function
      const negotiateResponse = await fetch(`${config.AZURE_API_URL}${config.endpoints.negotiate}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!negotiateResponse.ok) {
        throw new Error('Failed to negotiate SignalR connection');
      }

      const negotiateData = await negotiateResponse.json();
      console.log('✅ SignalR negotiation successful');

      // Create SignalR connection
      const connection = new signalR.HubConnectionBuilder()
        .withUrl(negotiateData.url, {
          accessTokenFactory: () => negotiateData.accessToken
        })
        .withAutomaticReconnect({
          nextRetryDelayInMilliseconds: (retryContext) => {
            if (retryContext.previousRetryCount === 0) return 0;
            if (retryContext.previousRetryCount === 1) return 2000;
            if (retryContext.previousRetryCount === 2) return 10000;
            return 30000;
          }
        })
        .configureLogging(signalR.LogLevel.Information)
        .build();

      // Set up event handlers
      connection.on('newMessage', (message) => {
        console.log('📨 SignalR message received:', message);
        handleSignalRMessage(message);
      });

      connection.onreconnecting((error) => {
        console.warn('⚠️ SignalR reconnecting...', error);
        setSignalRStatus('connecting');
      });

      connection.onreconnected((connectionId) => {
        console.log('✅ SignalR reconnected:', connectionId);
        setSignalRStatus('connected');
        // Rejoin group if needed
        if (serviceNowState.chatSessionId) {
          joinSignalRGroup(serviceNowState.chatSessionId);
        }
      });

      connection.onclose((error) => {
        console.error('❌ SignalR connection closed:', error);
        setSignalRStatus('disconnected');
      });

      // Start connection
      await connection.start();
      console.log('✅ SignalR connected successfully');
      
      setSignalRConnection(connection);
      signalRConnectionRef.current = connection;
      setSignalRStatus('connected');

      return connection;
    } catch (error) {
      console.error('❌ SignalR initialization failed:', error);
      setSignalRStatus('error');
      throw error;
    }
  };

  const joinSignalRGroup = async (chatSessionId) => {
    if (!signalRConnectionRef.current) {
      console.warn('⚠️ SignalR not connected, cannot join group');
      return;
    }

    try {
      const groupName = `conversation_${chatSessionId}`;
      console.log(`📡 Joining SignalR group: ${groupName}`);
      
      // Azure SignalR Service uses server-side group management
      // The group join happens automatically when messages are sent to that group
      // But we log it for debugging
      console.log(`✅ Ready to receive messages for group: ${groupName}`);
      
    } catch (error) {
      console.error('❌ Error joining SignalR group:', error);
    }
  };

  const handleSignalRMessage = (message) => {
    console.log('Processing SignalR message:', message);
    
    // Check if already seen
    if (seenMessageIdsRef.current.has(message.messageId)) {
      console.log('Duplicate message, ignoring');
      return;
    }
    
    seenMessageIdsRef.current.add(message.messageId);
    
    const newMessage = {
      id: message.messageId,
      text: message.messageText || message.message,
      sender: 'agent',
      timestamp: new Date(message.receivedAt || message.timestamp),
      metadata: {
        createdBy: message.createdBy,
        senderProfile: message.senderProfile,
        eventType: message.eventType
      }
    };
    
    setMessages(prev => [...prev, newMessage]);
    
    // Check for chat end event
    if (message.eventType === 'ChatEnded') {
      handleChatEnded();
    }
  };

  // ============== COPILOT FUNCTIONS ==============
  
  const initializeCopilot = async () => {
    setIsLoading(true);
    try {
      console.log('🤖 Initializing Copilot...');
      
      // Generate Direct Line token
      const tokenResponse = await fetch(`${config.getBackendUrl()}${config.endpoints.directLineTokenGenerate}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!tokenResponse.ok) {
        throw new Error('Failed to generate Direct Line token');
      }

      const tokenData = await tokenResponse.json();
      
      // Start conversation
      const conversationResponse = await fetch(`${config.getBackendUrl()}${config.endpoints.directLineConversations}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token: tokenData.token
        })
      });

      if (!conversationResponse.ok) {
        throw new Error('Failed to start conversation');
      }

      const conversationData = await conversationResponse.json();
      
      setCopilotConversationId(conversationData.conversationId);
      sessionMappingRef.current.copilotConversationId = conversationData.conversationId;
      
      setChatMode('copilot');
      chatModeRef.current = 'copilot';
      
      // Start polling
      startCopilotPolling(conversationData.conversationId);
      
      setMessages([{
        id: Date.now(),
        text: 'Connected to Copilot! How can I help you today?',
        sender: 'bot',
        timestamp: new Date()
      }]);
      
      console.log('✅ Copilot initialized');
    } catch (error) {
      console.error('❌ Copilot initialization failed:', error);
      setMessages([{
        id: Date.now(),
        text: `Failed to connect to Copilot: ${error.message}`,
        sender: 'system',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const startCopilotPolling = (convId) => {
    copilotPollIntervalRef.current = setInterval(() => {
      pollCopilotMessages(convId);
    }, 1000);
  };

  const pollCopilotMessages = async (convId) => {
    try {
      const url = `${config.getBackendUrl()}/api/directline/conversations/${convId}/activities`;
      const params = copilotWatermark ? `?watermark=${copilotWatermark}` : '';
      
      const response = await fetch(url + params);
      if (!response.ok) return;

      const data = await response.json();
      
      if (data.watermark) {
        setCopilotWatermark(data.watermark);
      }

      const newMessages = data.activities
        .filter(activity => {
          if (activity.type !== 'message') return false;
          if (activity.from.id === 'user') return false;
          return true;
        })
        .map(activity => ({
          id: activity.id,
          text: activity.text || '',
          sender: 'bot',
          timestamp: new Date(activity.timestamp)
        }));

      if (newMessages.length > 0) {
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const filteredNew = newMessages.filter(m => !existingIds.has(m.id));
          
          // Check for handoff trigger in new messages
          filteredNew.forEach(msg => {
            checkForHandoffTrigger(msg.text);
          });
          
          return [...prev, ...filteredNew];
        });
      }
    } catch (error) {
      console.error('Error polling Copilot messages:', error);
    }
  };

  const sendToCopilot = async (messageText) => {
    try {
      await fetch(`${config.getBackendUrl()}/api/directline/conversations/${copilotConversationId}/activities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'message',
          from: { id: 'user', name: 'User' },
          text: messageText
        })
      });
    } catch (error) {
      console.error('Error sending to Copilot:', error);
      throw error;
    }
  };

  // ============== SERVICENOW FUNCTIONS ==============
  
  const initiateServiceNowHandoff = async () => {
    try {
      console.log('🔄 Initiating ServiceNow handoff...');
      setChatMode('handoff');
      chatModeRef.current = 'handoff';
      
      // Initialize SignalR if not already connected
      if (!signalRConnectionRef.current || signalRStatus !== 'connected') {
        await initializeSignalR();
      }
      
      // Stop Copilot polling
      if (copilotPollIntervalRef.current) {
        clearInterval(copilotPollIntervalRef.current);
      }
      
      // Call ServiceNow Bot Integration API
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const clientMessageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const payload = {
        requestId: requestId,
        enterpriseId: "ServiceNow",
        nowBotId: serviceNowState.nowBotId,
        nowSessionId: serviceNowState.nowSessionId,
        topic: config.serviceNow.topicId,
        clientVariables: {},
        message: {
          text: "Transferring to live agent",
          typed: false,
          clientMessageId: clientMessageId,
          attachment: null
        },
        timestamp: Math.floor(Date.now() / 1000),
        botToBot: true,
        silentMessage: null,
        intent: null,
        contextVariables: sessionMappingRef.current.conversationContext,
        userId: config.serviceNow.username,
        emailId: `${config.serviceNow.username}@example.com`
      };
      
      const response = await fetch(`${config.getBackendUrl()}${config.endpoints.serviceNowBotIntegration}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          serviceNowUrl: config.serviceNow.baseUrl,
          username: config.serviceNow.username,
          password: serviceNowConfig.password,
          token: config.serviceNow.token,
          payload: payload
        })
      });

      if (!response.ok) {
        throw new Error('ServiceNow handoff failed');
      }

      const data = await response.json();
      console.log('ServiceNow response:', data);
      
      const chatSessionId = data.body?.uiData?.chatSessionId || data.chatSessionId;
      
      setServiceNowState(prev => ({
        ...prev,
        nowBotId: data.nowBotId || prev.nowBotId,
        nowSessionId: data.nowSessionId || prev.nowSessionId,
        requestId: requestId,
        chatSessionId: chatSessionId
      }));
      
      sessionMappingRef.current.serviceNowChatSessionId = chatSessionId;
      
      // Join SignalR group for this conversation
      if (chatSessionId) {
        await joinSignalRGroup(chatSessionId);
      }
      
      setChatMode('agent');
      chatModeRef.current = 'agent';
      
      setMessages(prev => [...prev, {
        id: Date.now(),
        text: data.body?.text || 'Connected to live agent. An agent will be with you shortly.',
        sender: 'system',
        timestamp: new Date()
      }]);
      
      console.log('✅ Handoff successful');
    } catch (error) {
      console.error('❌ ServiceNow handoff failed:', error);
      setMessages(prev => [...prev, {
        id: Date.now(),
        text: `Handoff failed: ${error.message}`,
        sender: 'system',
        timestamp: new Date()
      }]);
      setChatMode('copilot');
      chatModeRef.current = 'copilot';
    }
  };

  const sendToServiceNow = async (messageText) => {
    try {
      const clientMessageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const payload = {
        requestId: serviceNowState.requestId,
        enterpriseId: "ServiceNow",
        nowBotId: serviceNowState.nowBotId,
        nowSessionId: serviceNowState.nowSessionId,
        topic: config.serviceNow.topicId,
        message: {
          text: messageText,
          typed: true,
          clientMessageId: clientMessageId,
          attachment: null
        },
        timestamp: Math.floor(Date.now() / 1000),
        userId: config.serviceNow.username
      };
      
      await fetch(`${config.getBackendUrl()}${config.endpoints.serviceNowBotIntegration}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          serviceNowUrl: config.serviceNow.baseUrl,
          username: config.serviceNow.username,
          password: serviceNowConfig.password,
          token: config.serviceNow.token,
          payload: payload
        })
      });
    } catch (error) {
      console.error('Error sending to ServiceNow:', error);
      throw error;
    }
  };

  // ============== HELPER FUNCTIONS ==============
  
  const checkForHandoffTrigger = (messageText) => {
    const handoffKeywords = ['agent', 'human', 'speak to someone', 'escalate', 'representative'];
    const lowerText = messageText.toLowerCase();
    
    if (handoffKeywords.some(keyword => lowerText.includes(keyword)) && chatModeRef.current === 'copilot') {
      console.log('🔔 Handoff trigger detected');
      setTimeout(() => {
        initiateServiceNowHandoff();
      }, 1000);
    }
  };

  const handleChatEnded = () => {
    console.log('💬 Chat ended by agent');
    setChatMode('none');
    chatModeRef.current = 'none';
    
    if (signalRConnectionRef.current) {
      signalRConnectionRef.current.stop();
    }
    
    setMessages(prev => [...prev, {
      id: Date.now(),
      text: 'The agent has ended the conversation. You can start a new chat if needed.',
      sender: 'system',
      timestamp: new Date()
    }]);
  };

  // ============== MESSAGE SENDING ==============
  
  const sendMessage = async () => {
    if (!inputMessage.trim()) return;

    const userMessage = {
      id: `user-${Date.now()}`,
      text: inputMessage,
      sender: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const messageToSend = inputMessage;
    setInputMessage('');
    setIsLoading(true);

    try {
      if (chatModeRef.current === 'copilot') {
        await sendToCopilot(messageToSend);
      } else if (chatModeRef.current === 'agent') {
        await sendToServiceNow(messageToSend);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, {
        id: Date.now(),
        text: `Error: ${error.message}`,
        sender: 'system',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const startNewChat = () => {
    // Cleanup
    if (copilotPollIntervalRef.current) {
      clearInterval(copilotPollIntervalRef.current);
    }
    if (signalRConnectionRef.current) {
      signalRConnectionRef.current.stop();
    }
    
    // Reset state
    setMessages([]);
    setChatMode('none');
    chatModeRef.current = 'none';
    setCopilotConversationId('');
    setCopilotWatermark('');
    setServiceNowState({
      nowBotId: null,
      nowSessionId: null,
      requestId: null,
      chatSessionId: null
    });
    setSignalRStatus('disconnected');
    sessionMappingRef.current = {
      copilotConversationId: null,
      serviceNowChatSessionId: null,
      conversationContext: []
    };
    seenMessageIdsRef.current.clear();
    
    // Start new
    initializeCopilot();
  };

  // ============== RENDER ==============
  
  const getModeDisplay = () => {
    switch (chatMode) {
      case 'copilot': return { text: 'Copilot', color: 'text-purple-600', bg: 'bg-purple-100' };
      case 'handoff': return { text: 'Handoff in Progress', color: 'text-yellow-600', bg: 'bg-yellow-100' };
      case 'agent': return { text: 'Live Agent', color: 'text-green-600', bg: 'bg-green-100' };
      default: return { text: 'Not Started', color: 'text-gray-600', bg: 'bg-gray-100' };
    }
  };

  const mode = getModeDisplay();

  return (
    <div className="max-w-7xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="mb-6 pb-4 border-b">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800">Unified Chat with Intelligent Handoff</h1>
          <div className="flex items-center gap-4">
            {/* Mode Badge */}
            <div className={`px-3 py-1 rounded-full ${mode.bg} ${mode.color} text-sm font-semibold`}>
              {mode.text}
            </div>
            
            {/* SignalR Status */}
            {signalRStatus === 'connected' && (
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <Wifi className="w-4 h-4" />
                <span>Real-time Connected</span>
              </div>
            )}
            {signalRStatus === 'connecting' && (
              <div className="flex items-center gap-2 text-yellow-600 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Connecting...</span>
              </div>
            )}
            {signalRStatus === 'error' && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <WifiOff className="w-4 h-4" />
                <span>Connection Error</span>
              </div>
            )}
          </div>
        </div>
        
        {/* Environment Info */}
        <div className="mt-2 text-sm text-gray-500">
          Environment: {config.IS_PRODUCTION ? '🌐 Production (Azure)' : '💻 Local Development'}
        </div>
      </div>

      {/* Configuration Panel */}
      {showConfig && chatMode === 'none' && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-blue-800">ServiceNow Configuration</h3>
            <button
              onClick={() => setShowConfig(false)}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Hide
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ServiceNow Password:
              </label>
              <input
                type="password"
                value={serviceNowConfig.password}
                onChange={(e) => setServiceNowConfig({...serviceNowConfig, password: e.target.value})}
                placeholder="Enter ServiceNow password"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="text-xs text-gray-600">
              <p><strong>Base URL:</strong> {config.serviceNow.baseUrl}</p>
              <p><strong>Username:</strong> {config.serviceNow.username}</p>
              <p><strong>Topic ID:</strong> {config.serviceNow.topicId}</p>
            </div>
          </div>
        </div>
      )}

      {/* Chat Container */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        {/* Messages */}
        <div className="h-96 overflow-y-auto bg-gray-50 p-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
              <Bot className="w-16 h-16 mb-4 text-gray-400" />
              <p className="text-lg font-semibold mb-2">Ready to start a conversation</p>
              <p className="text-sm">Click "Start Chat" below to begin with Copilot</p>
              <p className="text-xs mt-2">Handoff to live agent will happen automatically if needed</p>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div key={message.id} className={`mb-4 flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex items-start gap-2 max-w-md ${message.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                      message.sender === 'user' 
                        ? 'bg-blue-500 text-white'
                        : message.sender === 'bot'
                        ? 'bg-purple-500 text-white'
                        : message.sender === 'agent'
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-500 text-white'
                    }`}>
                      {message.sender === 'user' ? <User className="w-4 h-4" /> : 
                       message.sender === 'agent' ? <UserCheck className="w-4 h-4" /> : 
                       <Bot className="w-4 h-4" />}
                    </div>
                    
                    <div className={`px-4 py-2 rounded-lg ${
                      message.sender === 'user'
                        ? 'bg-blue-500 text-white'
                        : message.sender === 'bot'
                        ? 'bg-white text-gray-800 border border-purple-200'
                        : message.sender === 'agent'
                        ? 'bg-white text-gray-800 border border-green-200'
                        : 'bg-gray-200 text-gray-700'
                    }`}>
                      <div className="text-sm">{message.text}</div>
                      <div className={`text-xs mt-1 ${
                        message.sender === 'user' ? 'text-blue-100' : 'text-gray-500'
                      }`}>
                        {message.timestamp.toLocaleTimeString()}
                        {message.sender === 'agent' && message.metadata?.createdBy && (
                          <span className="ml-2">• {message.metadata.createdBy}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-gray-200">
          {chatMode === 'none' ? (
            <button
              onClick={startNewChat}
              disabled={!serviceNowConfig.password}
              className="w-full px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
            >
              Start Chat with Copilot
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type your message..."
                  disabled={isLoading || chatMode === 'handoff'}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                />
                <button
                  onClick={sendMessage}
                  disabled={isLoading || !inputMessage.trim() || chatMode === 'handoff'}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>
              
              <div className="flex justify-between items-center">
                <div className="text-xs text-gray-500">
                  {chatMode === 'handoff' && 'Transferring to live agent...'}
                  {chatMode === 'agent' && 'Connected to live agent via real-time SignalR'}
                </div>
                <button
                  onClick={startNewChat}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Start New Chat
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Info Panel */}
      <div className="mt-4 p-4 bg-gray-50 rounded-lg text-sm text-gray-600">
        <h4 className="font-semibold text-gray-800 mb-2">How it works:</h4>
        <ol className="list-decimal list-inside space-y-1 text-xs">
          <li>Chat starts with Microsoft Copilot using Direct Line</li>
          <li>Copilot answers questions and provides assistance</li>
          <li>If handoff keywords detected (e.g., "speak to agent"), automatic escalation occurs</li>
          <li>Chat is transferred to ServiceNow live agent</li>
          <li>Real-time messaging via Azure SignalR Service</li>
          <li>All messages stored in Azure Table Storage</li>
        </ol>
      </div>
    </div>
  );
};

export default UnifiedChatWithHandoff;