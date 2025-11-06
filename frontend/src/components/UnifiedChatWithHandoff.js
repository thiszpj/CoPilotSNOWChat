import React, { useState, useEffect, useRef } from 'react';
import * as signalR from '@microsoft/signalr';
import * as microsoftTeams from '@microsoft/teams-js';  // ← ADDED
import config from '../config';

const UnifiedChatWithHandoff = () => {
  // ============== STATE MANAGEMENT ==============
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Chat mode: 'none' | 'copilot' | 'handoff' | 'agent'
  const [chatMode, setChatMode] = useState('none');
  const chatModeRef = useRef('none');
  
  // Copilot state
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
  
  // ServiceNow password (temporary - will be replaced with SSO)
  const [serviceNowPassword, setServiceNowPassword] = useState('');
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  
  // Teams state ← ADDED
  const [teamsContext, setTeamsContext] = useState(null);
  const [isInTeams, setIsInTeams] = useState(false);
  
  // SignalR
  const [signalRStatus, setSignalRStatus] = useState('disconnected');
  const signalRConnectionRef = useRef(null);
  
  // Session management
  const [sessionId] = useState(() => {
    return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  });
  
  const sessionMappingRef = useRef({
    copilotConversationId: null,
    serviceNowChatSessionId: null,
    conversationContext: []
  });
  
  const seenMessageIdsRef = useRef(new Set());
  const messagesEndRef = useRef(null);

  // ============== TEAMS SDK INITIALIZATION ============== ← ADDED
  useEffect(() => {
    initializeTeamsSDK();
  }, []);

  const initializeTeamsSDK = async () => {
    try {
      // Try to initialize Teams SDK
      await microsoftTeams.app.initialize();
      
      console.log('✅ Teams SDK initialized - Running in Microsoft Teams');
      setIsInTeams(true);
      
      // Get Teams context
      const context = await microsoftTeams.app.getContext();
      console.log('📱 Teams Context:', context);
      
      setTeamsContext(context);
      
      // You can use context for user info:
      // context.user.id
      // context.user.userPrincipalName
      // context.user.displayName
      // context.app.theme (dark/light/contrast)
      
      addSystemNotification(`Welcome ${context.user.displayName || 'to Support Chat'}! 👋`, 'info');
      
    } catch (error) {
      console.log('ℹ️ Not running in Teams - Using standalone mode');
      setIsInTeams(false);
    }
  };

  // ============== SCROLL TO BOTTOM ==============
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // ============== INITIALIZATION ==============
  useEffect(() => {
    console.log('🆔 Session ID:', sessionId);
    console.log('📱 Running in Teams:', isInTeams);
  }, [sessionId, isInTeams]);

  // ============== SYSTEM NOTIFICATIONS ==============
  const addSystemNotification = (text, type = 'info') => {
    const notification = {
      id: `system-${Date.now()}`,
      text: text,
      sender: 'system',
      type: type, // 'info', 'success', 'warning', 'error'
      timestamp: new Date()
    };
    setMessages(prev => [...prev, notification]);
  };

  // ============== COPILOT FUNCTIONS ==============
  const initializeCopilot = async () => {
    if (chatMode !== 'none') return;
    
    try {
      setIsLoading(true);
      addSystemNotification('Connecting to Copilot...', 'info');

      // Generate token
      const tokenResponse = await fetch(`${config.getBackendUrl()}${config.endpoints.directLineTokenGenerate}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!tokenResponse.ok) throw new Error('Failed to generate token');
      const { token } = await tokenResponse.json();

      // Start conversation
      const convResponse = await fetch(`${config.getBackendUrl()}${config.endpoints.directLineConversations}`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!convResponse.ok) throw new Error('Failed to create conversation');
      const convData = await convResponse.json();

      setCopilotConversationId(convData.conversationId);
      sessionMappingRef.current.copilotConversationId = convData.conversationId;

      setChatMode('copilot');
      chatModeRef.current = 'copilot';
      
      addSystemNotification('✅ Connected to Copilot. How can I help you today?', 'success');

      // Start polling
      startCopilotPolling(convData.conversationId);

    } catch (error) {
      console.error('❌ Copilot initialization failed:', error);
      addSystemNotification(`Failed to connect: ${error.message}`, 'error');
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
          
          if (filteredNew.length > 0) {
            checkForHandoffTrigger(filteredNew[filteredNew.length - 1].text);
          }
          
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
      addSystemNotification('Connecting you to a live agent...', 'info');
      
      // Check if password is set
      if (!serviceNowPassword) {
        setShowPasswordInput(true);
        addSystemNotification('⚠️ Please enter ServiceNow password to connect to an agent', 'warning');
        return;
      }
      
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
      
      // Use Teams context if available ← MODIFIED
      const userId = teamsContext?.user.id || sessionId;
      const userEmail = teamsContext?.user.userPrincipalName || `${sessionId}@example.com`;
      const userName = teamsContext?.user.displayName || 'Guest User';
      
      const payload = {
        requestId: requestId,
        enterpriseId: "ServiceNow",
        nowBotId: serviceNowState.nowBotId || null,
        nowSessionId: serviceNowState.nowSessionId || null,
        topic: config.serviceNow.topicId,
        clientVariables: {},
        message: {
          text: "User requesting live agent assistance",
          typed: false,
          clientMessageId: clientMessageId,
          attachment: null
        },
        timestamp: Math.floor(Date.now() / 1000),
        botToBot: true,
        silentMessage: null,
        intent: null,
        contextVariables: {},
        userId: userId,        // ← Uses Teams ID if available
        emailId: userEmail,    // ← Uses Teams email if available
        userName: userName     // ← Uses Teams name if available
      };
      
      console.log('📤 Handoff payload:', payload);
      
      const response = await fetch(`${config.getBackendUrl()}${config.endpoints.serviceNowBotIntegration}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          serviceNowUrl: config.serviceNow.baseUrl,
          username: config.serviceNow.username,
          password: serviceNowPassword,
          token: config.serviceNow.token,
          payload: payload
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('❌ Backend error:', response.status, errorData);
        throw new Error('ServiceNow handoff failed');
      }

      const data = await response.json();
      console.log('✅ ServiceNow response:', data);

      // Extract chatSessionId
      const chatSessionId = data.body?.find(
        item => item.actionType === 'SubscribeToChatPresence'
      )?.chatSessionId || data.chatSessionId;

      if (!chatSessionId) {
        throw new Error('Failed to extract chatSessionId from ServiceNow response');
      }

      console.log('🔑 Chat Session ID:', chatSessionId);

      setServiceNowState({
        nowBotId: data.nowBotId || null,
        nowSessionId: data.nowSessionId || null,
        requestId: requestId,
        chatSessionId: chatSessionId
      });

      sessionMappingRef.current.serviceNowChatSessionId = chatSessionId;

      // Join SignalR group
      await joinSignalRGroup(chatSessionId);

      setChatMode('agent');
      chatModeRef.current = 'agent';
      
      addSystemNotification('✅ Connected to live agent. An agent will be with you shortly.', 'success');

    } catch (error) {
      console.error('❌ ServiceNow handoff failed:', error);
      addSystemNotification(`Failed to connect to agent: ${error.message}`, 'error');
      setChatMode('copilot');
      chatModeRef.current = 'copilot';
    }
  };

  const sendToServiceNow = async (messageText) => {
    try {
      const clientMessageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Use Teams context if available ← MODIFIED
      const userId = teamsContext?.user.id || sessionId;
      
      const payload = {
        requestId: serviceNowState.requestId,
        enterpriseId: "ServiceNow",
        nowBotId: serviceNowState.nowBotId,
        nowSessionId: serviceNowState.chatSessionId || serviceNowState.nowSessionId,
        topic: config.serviceNow.topicId,
        message: {
          text: messageText,
          typed: true,
          clientMessageId: clientMessageId,
          attachment: null
        },
        timestamp: Math.floor(Date.now() / 1000),
        userId: userId  // ← Uses Teams ID if available
      };
      
      console.log('📤 Sending message to ServiceNow:', payload);
      
      await fetch(`${config.getBackendUrl()}${config.endpoints.serviceNowBotIntegration}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          serviceNowUrl: config.serviceNow.baseUrl,
          username: config.serviceNow.username,
          password: serviceNowPassword,
          token: config.serviceNow.token,
          payload: payload
        })
      });
      
      console.log('✅ Message sent to ServiceNow successfully');
      
    } catch (error) {
      console.error('❌ Error sending to ServiceNow:', error);
      throw error;
    }
  };

  // ============== SIGNALR FUNCTIONS ==============
  const initializeSignalR = async () => {
    try {
      console.log('🔌 Initializing SignalR...');
      
      const negotiateUrl = config.IS_PRODUCTION 
        ? `${config.AZURE_BASE_URL}${config.endpoints.negotiate}`
        : 'http://localhost:7071/api/negotiate';

      const negotiateResponse = await fetch(negotiateUrl, { method: 'POST' });
      
      if (!negotiateResponse.ok) {
        throw new Error('SignalR negotiation failed');
      }

      const negotiateData = await negotiateResponse.json();

      const connection = new signalR.HubConnectionBuilder()
        .withUrl(negotiateData.url, {
          accessTokenFactory: () => negotiateData.accessToken
        })
        .withAutomaticReconnect()
        .configureLogging(signalR.LogLevel.Information)
        .build();

      connection.on('newMessage', (message) => {
        handleSignalRMessage(message);
      });

      connection.onreconnecting(() => {
        console.log('🔄 SignalR reconnecting...');
        setSignalRStatus('reconnecting');
      });

      connection.onreconnected(() => {
        console.log('✅ SignalR reconnected');
        setSignalRStatus('connected');
        addSystemNotification('Reconnected to live chat', 'success');
      });

      connection.onclose(() => {
        console.log('❌ SignalR connection closed');
        setSignalRStatus('disconnected');
      });

      await connection.start();
      console.log('✅ SignalR connected');
      setSignalRStatus('connected');

      signalRConnectionRef.current = connection;

    } catch (error) {
      console.error('❌ SignalR initialization failed:', error);
      setSignalRStatus('error');
      addSystemNotification('Failed to establish real-time connection', 'error');
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
      const connectionId = signalRConnectionRef.current.connectionId;
      
      console.log(`📡 Joining SignalR group: ${groupName}`);
      
      const azureFunctionUrl = config.IS_PRODUCTION 
        ? `${config.AZURE_BASE_URL}/api/joingroup`
        : 'http://localhost:7071/api/joingroup';
      
      const response = await fetch(azureFunctionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: connectionId,
          groupName: groupName
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to join group: ${errorText}`);
      }
      
      const result = await response.json();
      console.log(`✅ Successfully joined SignalR group:`, result);
      
    } catch (error) {
      console.error('❌ Error joining SignalR group:', error);
    }
  };

  const handleSignalRMessage = (message) => {
    console.log('📨 SignalR message received:', message);

    const messageId = message.messageId || message.id || `signalr-${Date.now()}`;

    if (seenMessageIdsRef.current.has(messageId)) {
      console.log('⏭️ Duplicate message, skipping:', messageId);
      return;
    }

    seenMessageIdsRef.current.add(messageId);

    const newMessage = {
      id: messageId,
      text: message.messageText || message.message || message.text || '',
      sender: 'agent',
      agentName: message.created_by || 'Agent',
      timestamp: message.created_on ? new Date(message.created_on) : new Date()
    };

    setMessages(prev => [...prev, newMessage]);
  };

  const handleAgentEndChat = () => {
    console.log('💬 Chat ended by agent');
    setChatMode('none');
    chatModeRef.current = 'none';
    
    if (signalRConnectionRef.current) {
      signalRConnectionRef.current.stop();
    }
    
    addSystemNotification('The agent has ended the conversation. You can start a new chat if needed.', 'info');
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
      addSystemNotification(`Error: ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const startNewChat = () => {
    if (copilotPollIntervalRef.current) {
      clearInterval(copilotPollIntervalRef.current);
    }
    if (signalRConnectionRef.current) {
      signalRConnectionRef.current.stop();
    }
    
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
    
    initializeCopilot();
  };

  // ============== HELPER FUNCTIONS ==============
  const checkForHandoffTrigger = (messageText) => {
    const handoffKeywords = ['agent', 'human', 'speak to someone', 'escalate', 'representative', 'live chat'];
    const lowerText = messageText.toLowerCase();
    
    if (handoffKeywords.some(keyword => lowerText.includes(keyword)) && chatModeRef.current === 'copilot') {
      console.log('🔔 Handoff trigger detected');
      chatModeRef.current = 'handoff';
      setTimeout(() => {
        initiateServiceNowHandoff();
      }, 1000);
    }
  };

  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  // ============== RENDER ==============
  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header - Teams Style */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Support Chat</h1>
            <p className="text-xs text-gray-500">
              {chatMode === 'copilot' && 'AI Assistant'}
              {chatMode === 'agent' && 'Live Agent'}
              {chatMode === 'handoff' && 'Connecting...'}
              {chatMode === 'none' && (isInTeams ? '📱 Teams' : 'Ready to help')}
            </p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Password Input - Small, discreet */}
          {showPasswordInput && (
            <div className="flex items-center space-x-1 mr-2">
              <input
                type="password"
                value={serviceNowPassword}
                onChange={(e) => setServiceNowPassword(e.target.value)}
                placeholder="Password"
                className="text-xs px-2 py-1 border border-gray-300 rounded w-24 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={() => {
                  setShowPasswordInput(false);
                  if (chatMode === 'handoff') {
                    initiateServiceNowHandoff();
                  }
                }}
                className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                OK
              </button>
            </div>
          )}
          
          {chatMode !== 'none' && (
            <button
              onClick={startNewChat}
              className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded flex items-center space-x-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>New Chat</span>
            </button>
          )}
        </div>
      </div>

      {/* Messages Area - Teams Style */}
      <div className="flex-1 overflow-y-auto bg-gray-50 px-4 py-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.length === 0 && chatMode === 'none' && (
            <div className="text-center py-16">
              <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                Welcome to Support Chat
                {isInTeams && ' 📱'}
              </h2>
              <p className="text-gray-600 mb-2">Get instant help from our AI assistant or connect with a live agent</p>
              {teamsContext && (
                <p className="text-sm text-gray-500 mb-6">
                  Signed in as: {teamsContext.user.displayName}
                </p>
              )}
              <button
                onClick={initializeCopilot}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm"
              >
                Start Chat
              </button>
            </div>
          )}

          {messages.map((message) => {
            if (message.sender === 'system') {
              return (
                <div key={message.id} className="flex justify-center my-4">
                  <div className={`
                    max-w-md px-4 py-2 rounded-full text-xs font-medium
                    ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : ''}
                    ${message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : ''}
                    ${message.type === 'warning' ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' : ''}
                    ${message.type === 'info' ? 'bg-blue-50 text-blue-700 border border-blue-200' : ''}
                  `}>
                    {message.text}
                  </div>
                </div>
              );
            }

            if (message.sender === 'user') {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="flex flex-col items-end max-w-xl">
                    <div className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow-sm">
                      <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                    </div>
                    <span className="text-xs text-gray-500 mt-1">{formatTime(message.timestamp)}</span>
                  </div>
                </div>
              );
            }

            if (message.sender === 'bot' || message.sender === 'agent') {
              return (
                <div key={message.id} className="flex justify-start">
                  <div className="flex space-x-2 max-w-xl">
                    <div className="flex-shrink-0">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        message.sender === 'bot' 
                          ? 'bg-gradient-to-br from-purple-500 to-blue-500' 
                          : 'bg-gradient-to-br from-green-500 to-teal-500'
                      }`}>
                        {message.sender === 'bot' ? (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200">
                        {message.sender === 'agent' && message.agentName && (
                          <p className="text-xs font-semibold text-gray-700 mb-1">{message.agentName}</p>
                        )}
                        <p className="text-sm text-gray-900 whitespace-pre-wrap">{message.text}</p>
                      </div>
                      <span className="text-xs text-gray-500 mt-1 ml-1">{formatTime(message.timestamp)}</span>
                    </div>
                  </div>
                </div>
              );
            }

            return null;
          })}

          {isLoading && (
            <div className="flex justify-start">
              <div className="flex space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="bg-white px-4 py-3 rounded-lg shadow-sm border border-gray-200">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area - Teams Style */}
      {chatMode !== 'none' && (
        <div className="bg-white border-t border-gray-200 px-4 py-3">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-end space-x-2">
              <div className="flex-1 relative">
                <textarea
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  rows={1}
                  className="w-full px-4 py-2.5 pr-12 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  style={{ minHeight: '42px', maxHeight: '120px' }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!inputMessage.trim() || isLoading}
                  className="absolute right-2 bottom-2 p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
            
            {/* Subtle hint */}
            {chatMode === 'copilot' && (
              <p className="text-xs text-gray-500 mt-2 text-center">
                Type "agent" or "I need a human" to connect with a live support agent
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default UnifiedChatWithHandoff;