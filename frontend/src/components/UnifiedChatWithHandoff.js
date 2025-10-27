import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Loader2, UserCheck, AlertCircle, CheckCircle, Wifi, WifiOff } from 'lucide-react';
import * as signalR from '@microsoft/signalr';

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
  const [copilotToken, setCopilotToken] = useState('');
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
  const [signalRStatus, setSignalRStatus] = useState('disconnected'); // 'disconnected', 'connecting', 'connected', 'error'
  const signalRConnectionRef = useRef(null);
  
  // Session mapping: Maps chatSessionId (ServiceNow) <-> conversationId (Copilot)
  const sessionMappingRef = useRef({
    copilotConversationId: null,
    serviceNowChatSessionId: null,
    conversationContext: []
  });
  
  // Configuration
  const [config, setConfig] = useState({
    backendUrl: 'http://localhost:3001',
    azureFunctionUrl: 'https://wonderful-sky-0661cc20f.3.azurestaticapps.net', // Update this with your Azure Function URL
    serviceNowUrl: 'https://dev205527.service-now.com',
    serviceNowUsername: 'admin',
    serviceNowPassword: '',
    serviceNowToken: 'TGbK5XRDgtmf4rK',
    serviceNowTopicId: 'ce2ee85053130010cf8cddeeff7b12bf'
  });
  
  const [showConfig, setShowConfig] = useState(true);
  const messagesEndRef = useRef(null);
  const seenMessageIdsRef = useRef(new Set());

  // Auto-scroll to bottom
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
      
      // Create SignalR connection
      const connection = new signalR.HubConnectionBuilder()
        .withUrl(`${config.azureFunctionUrl}/api`, {
          withCredentials: false
        })
        .withAutomaticReconnect({
          nextRetryDelayInMilliseconds: (retryContext) => {
            // Exponential backoff: 0s, 2s, 10s, 30s
            if (retryContext.previousRetryCount === 0) return 0;
            if (retryContext.previousRetryCount === 1) return 2000;
            if (retryContext.previousRetryCount === 2) return 10000;
            return 30000;
          }
        })
        .configureLogging(signalR.LogLevel.Information)
        .build();

      // Handle reconnecting
      connection.onreconnecting((error) => {
        console.log('🔄 SignalR reconnecting...', error);
        setSignalRStatus('connecting');
        addSystemMessage('Connection lost. Reconnecting...');
      });

      // Handle reconnected
      connection.onreconnected((connectionId) => {
        console.log('✅ SignalR reconnected:', connectionId);
        setSignalRStatus('connected');
        addSystemMessage('Connection restored!');
        
        // Rejoin the conversation group
        if (serviceNowState.chatSessionId) {
          joinConversationGroup(serviceNowState.chatSessionId);
        }
      });

      // Handle close
      connection.onclose((error) => {
        console.log('❌ SignalR connection closed:', error);
        setSignalRStatus('disconnected');
        addSystemMessage('Connection closed. Please refresh to reconnect.');
      });

      // Listen for new messages from ServiceNow agents
      connection.on('newMessage', (message) => {
        console.log('📨 Received message via SignalR:', message);
        handleSignalRMessage(message);
      });

      // Start the connection
      await connection.start();
      console.log('✅ SignalR connected:', connection.connectionId);
      setSignalRStatus('connected');
      
      setSignalRConnection(connection);
      signalRConnectionRef.current = connection;
      
      return connection;
      
    } catch (error) {
      console.error('❌ SignalR initialization failed:', error);
      setSignalRStatus('error');
      addSystemMessage(`SignalR connection failed: ${error.message}`);
      return null;
    }
  };

  const joinConversationGroup = async (chatSessionId) => {
    if (!signalRConnectionRef.current) {
      console.error('❌ Cannot join group: SignalR not connected');
      return;
    }
    
    try {
      const groupName = `conversation_${chatSessionId}`;
      console.log(`📢 Joining SignalR group: ${groupName}`);
      
      await signalRConnectionRef.current.invoke('JoinGroup', groupName);
      console.log(`✅ Successfully joined group: ${groupName}`);
      
      addSystemMessage(`Joined conversation group: ${chatSessionId.substring(0, 8)}...`);
      
    } catch (error) {
      console.error('❌ Failed to join conversation group:', error);
      addSystemMessage(`Failed to join conversation group: ${error.message}`);
    }
  };

  const leaveConversationGroup = async (chatSessionId) => {
    if (!signalRConnectionRef.current) return;
    
    try {
      const groupName = `conversation_${chatSessionId}`;
      console.log(`👋 Leaving SignalR group: ${groupName}`);
      
      await signalRConnectionRef.current.invoke('LeaveGroup', groupName);
      console.log(`✅ Successfully left group: ${groupName}`);
      
    } catch (error) {
      console.error('❌ Failed to leave conversation group:', error);
    }
  };

  const handleSignalRMessage = (message) => {
    // Prevent duplicate messages
    if (seenMessageIdsRef.current.has(message.messageId)) {
      console.log('⏭️ Skipping duplicate message:', message.messageId);
      return;
    }
    
    seenMessageIdsRef.current.add(message.messageId);
    
    // Only process messages for the current conversation
    if (message.conversationId !== serviceNowState.chatSessionId) {
      console.log('⏭️ Skipping message for different conversation');
      return;
    }
    
    // Add the message to the chat
    const newMessage = {
      id: message.messageId,
      text: message.messageText,
      sender: 'agent',
      timestamp: new Date(message.receivedAt || Date.now()),
      senderProfile: message.senderProfile || { name: 'Live Agent', type: 'agent' },
      metadata: {
        messageType: message.messageType,
        eventType: message.eventType,
        conversationId: message.conversationId
      }
    };
    
    setMessages(prev => [...prev, newMessage]);
    console.log('✅ Added agent message to chat:', newMessage.text);
  };

  // ============== COPILOT FUNCTIONS ==============
  
  const initializeCopilot = async () => {
    setIsLoading(true);
    try {
      // Initialize SignalR first (for future agent messages)
      await initializeSignalR();
      
      console.log('🔐 Generating Direct Line token...');
      const tokenResponse = await fetch(`${config.backendUrl}/api/directline/tokens/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!tokenResponse.ok) {
        throw new Error('Token generation failed');
      }

      const tokenData = await tokenResponse.json();
      const generatedToken = tokenData.token;
      setCopilotToken(generatedToken);
      console.log('✅ Token generated');

      console.log('🔄 Starting conversation...');
      const conversationResponse = await fetch(`${config.backendUrl}/api/directline/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: generatedToken })
      });

      if (!conversationResponse.ok) {
        throw new Error('Conversation creation failed');
      }

      const conversationData = await conversationResponse.json();
      const conversationId = conversationData.conversationId;
      setCopilotConversationId(conversationId);
      
      // Store in session mapping
      sessionMappingRef.current.copilotConversationId = conversationId;
      
      // Set mode BEFORE starting polling
      setChatMode('copilot');
      chatModeRef.current = 'copilot';
      
      startCopilotPolling(conversationId);
      
      addSystemMessage('Connected to Copilot! You can now start chatting.');
      setShowConfig(false);
      
      console.log('🎉 Successfully connected to Copilot!');
      console.log('📋 Session Mapping:', sessionMappingRef.current);
      
    } catch (error) {
      console.error('❌ Failed to initialize Copilot:', error);
      addSystemMessage(`Failed to connect to Copilot: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const startCopilotPolling = (convId) => {
    copilotPollIntervalRef.current = setInterval(() => {
      pollCopilotMessages(convId);
    }, 1000);
  };

  const stopCopilotPolling = () => {
    if (copilotPollIntervalRef.current) {
      clearInterval(copilotPollIntervalRef.current);
      copilotPollIntervalRef.current = null;
    }
  };

  const pollCopilotMessages = async (convId) => {
    try {
      const url = `${config.backendUrl}/api/directline/conversations/${convId}/activities`;
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
          if (activity.from.name === 'User') return false;
          return true;
        })
        .map(activity => ({
          id: activity.id,
          text: activity.text || 'No text content',
          sender: 'copilot',
          timestamp: new Date(activity.timestamp),
          attachments: activity.attachments || [],
          rawActivity: activity
        }));

      if (newMessages.length > 0) {
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const filteredNew = newMessages.filter(m => !existingIds.has(m.id));
          
          // Store in conversation context for handoff
          filteredNew.forEach(msg => {
            sessionMappingRef.current.conversationContext.push({
              sender: 'copilot',
              text: msg.text,
              timestamp: msg.timestamp
            });
            
            // Check for handoff trigger
            checkForHandoffTrigger(msg);
          });
          
          return [...prev, ...filteredNew];
        });
      }
    } catch (error) {
      console.error('Error polling Copilot messages:', error);
    }
  };

  const sendMessageToCopilot = async (text) => {
    try {
      // Store user message in context
      sessionMappingRef.current.conversationContext.push({
        sender: 'user',
        text: text,
        timestamp: new Date()
      });
      
      const response = await fetch(`${config.backendUrl}/api/directline/conversations/${copilotConversationId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'message',
          from: { id: 'user', name: 'User' },
          text: text
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send message');
      }
      
      console.log('✅ Message sent to Copilot');
    } catch (error) {
      console.error('Error sending message to Copilot:', error);
      addSystemMessage(`Error sending message: ${error.message}`);
    }
  };

  // ============== SERVICENOW FUNCTIONS ==============
  
  const checkForHandoffTrigger = (message) => {
    const handoffKeywords = [
      'transferring you to an agent',
      'connect you with an agent',
      'connecting you to',
      'transfer you to a live agent',
      'escalating to',
      'handoff',
      'live agent'
    ];

    const messageText = message.text?.toLowerCase() || '';
    const isHandoffTriggered = handoffKeywords.some(keyword => 
      messageText.includes(keyword.toLowerCase())
    );

    if (isHandoffTriggered && chatModeRef.current === 'copilot') {
      console.log('🔄 Handoff triggered! Message:', message.text);
      initiateHandoff();
    }
  };

  const initiateHandoff = async () => {
    setChatMode('handoff');
    chatModeRef.current = 'handoff';
    
    addSystemMessage('🔄 Transferring to live agent...');
    
    // Stop Copilot polling
    stopCopilotPolling();
    
    try {
      await initiateServiceNowConversation();
    } catch (error) {
      console.error('❌ Handoff failed:', error);
      addSystemMessage(`Handoff failed: ${error.message}`);
      setChatMode('copilot');
      chatModeRef.current = 'copilot';
      startCopilotPolling(copilotConversationId);
    }
  };

  const initiateServiceNowConversation = async () => {
    try {
      const requestId = generateRequestId();
      const clientMessageId = generateClientMessageId();
      
      // Prepare conversation context for ServiceNow
      const conversationSummary = sessionMappingRef.current.conversationContext
        .map(msg => `${msg.sender}: ${msg.text}`)
        .join('\n');

      const payload = {
        requestId: requestId,
        enterpriseId: "ServiceNow",
        nowBotId: serviceNowState.nowBotId,
        nowSessionId: serviceNowState.nowSessionId,
        topic: config.serviceNowTopicId,
        clientVariables: {
          conversationContext: conversationSummary,
          copilotConversationId: copilotConversationId
        },
        message: {
          text: `Handoff from Copilot. Previous conversation:\n${conversationSummary}`,
          typed: false,
          clientMessageId: clientMessageId,
          attachment: null
        },
        timestamp: Math.floor(Date.now() / 1000),
        botToBot: true,
        silentMessage: null,
        intent: null,
        contextVariables: {
          handoffSource: 'copilot',
          originalConversationId: copilotConversationId
        },
        userId: config.serviceNowUsername,
        emailId: `${config.serviceNowUsername}@example.com`
      };

      console.log('📤 Sending ServiceNow handoff request:', payload);

      const response = await fetch(`${config.backendUrl}/api/servicenow/bot/integration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceNowUrl: config.serviceNowUrl,
          username: config.serviceNowUsername,
          password: config.serviceNowPassword,
          token: config.serviceNowToken,
          payload: payload
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ ServiceNow response:', data);

      // Extract chat session ID
      let chatSessionId = null;
      if (data.body?.uiData?.chatSessionId) {
        chatSessionId = data.body.uiData.chatSessionId;
      } else if (data.chatSessionId) {
        chatSessionId = data.chatSessionId;
      }

      // Update ServiceNow state
      const newState = {
        nowBotId: data.nowBotId || serviceNowState.nowBotId,
        nowSessionId: data.nowSessionId || serviceNowState.nowSessionId,
        requestId: requestId,
        chatSessionId: chatSessionId || serviceNowState.chatSessionId
      };
      
      setServiceNowState(newState);
      
      // Store in session mapping
      sessionMappingRef.current.serviceNowChatSessionId = chatSessionId;
      
      console.log('📋 Updated Session Mapping:', sessionMappingRef.current);

      // Join SignalR group for this conversation
      if (chatSessionId && signalRConnectionRef.current) {
        await joinConversationGroup(chatSessionId);
      }

      // Update mode to agent
      setChatMode('agent');
      chatModeRef.current = 'agent';
      
      addSystemMessage('✅ Connected to live agent! You can now chat.');
      
      // Add initial ServiceNow response if available
      if (data.body?.text) {
        const agentMessage = {
          id: `sn-${Date.now()}`,
          text: data.body.text,
          sender: 'agent',
          timestamp: new Date(),
          senderProfile: { name: 'ServiceNow Agent', type: 'agent' }
        };
        setMessages(prev => [...prev, agentMessage]);
      }

    } catch (error) {
      console.error('❌ Error initiating ServiceNow conversation:', error);
      throw error;
    }
  };

  const sendMessageToServiceNow = async (text) => {
    try {
      const clientMessageId = generateClientMessageId();
      
      const payload = {
        requestId: serviceNowState.requestId,
        enterpriseId: "ServiceNow",
        nowBotId: serviceNowState.nowBotId,
        nowSessionId: serviceNowState.nowSessionId,
        topic: config.serviceNowTopicId,
        clientVariables: {},
        message: {
          text: text,
          typed: true,
          clientMessageId: clientMessageId,
          attachment: null
        },
        timestamp: Math.floor(Date.now() / 1000),
        botToBot: false,
        silentMessage: null,
        intent: null,
        contextVariables: {},
        userId: config.serviceNowUsername,
        emailId: `${config.serviceNowUsername}@example.com`
      };

      console.log('📤 Sending message to ServiceNow:', payload);

      const response = await fetch(`${config.backendUrl}/api/servicenow/bot/integration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceNowUrl: config.serviceNowUrl,
          username: config.serviceNowUsername,
          password: config.serviceNowPassword,
          token: config.serviceNowToken,
          payload: payload
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ ServiceNow message sent successfully:', data);

    } catch (error) {
      console.error('❌ Error sending message to ServiceNow:', error);
      addSystemMessage(`Error sending message: ${error.message}`);
    }
  };

  // ============== UTILITY FUNCTIONS ==============
  
  const generateRequestId = () => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const generateClientMessageId = () => {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const addSystemMessage = (text) => {
    const systemMessage = {
      id: `system-${Date.now()}`,
      text: text,
      sender: 'system',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, systemMessage]);
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return;
    
    const userMessage = {
      id: `user-${Date.now()}`,
      text: inputMessage,
      sender: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const messageText = inputMessage;
    setInputMessage('');
    setIsLoading(true);

    try {
      if (chatMode === 'copilot') {
        await sendMessageToCopilot(messageText);
      } else if (chatMode === 'agent') {
        await sendMessageToServiceNow(messageText);
      }
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const resetChat = () => {
    // Leave SignalR group if connected
    if (serviceNowState.chatSessionId) {
      leaveConversationGroup(serviceNowState.chatSessionId);
    }
    
    // Stop polling
    stopCopilotPolling();
    
    // Disconnect SignalR
    if (signalRConnectionRef.current) {
      signalRConnectionRef.current.stop();
      signalRConnectionRef.current = null;
    }
    
    // Reset all state
    setMessages([]);
    setChatMode('none');
    chatModeRef.current = 'none';
    setCopilotConversationId('');
    setCopilotToken('');
    setCopilotWatermark('');
    setServiceNowState({
      nowBotId: null,
      nowSessionId: null,
      requestId: null,
      chatSessionId: null
    });
    setSignalRConnection(null);
    setSignalRStatus('disconnected');
    sessionMappingRef.current = {
      copilotConversationId: null,
      serviceNowChatSessionId: null,
      conversationContext: []
    };
    seenMessageIdsRef.current.clear();
    setShowConfig(true);
  };

  // ============== RENDER ==============

  const getStatusColor = () => {
    if (chatMode === 'none') return 'bg-gray-400';
    if (chatMode === 'copilot') return 'bg-blue-500';
    if (chatMode === 'handoff') return 'bg-yellow-500 animate-pulse';
    if (chatMode === 'agent') return 'bg-green-500';
    return 'bg-gray-400';
  };

  const getStatusText = () => {
    if (chatMode === 'none') return 'Not Connected';
    if (chatMode === 'copilot') return 'Chatting with Copilot';
    if (chatMode === 'handoff') return 'Transferring to Agent...';
    if (chatMode === 'agent') return 'Connected to Live Agent';
    return 'Unknown';
  };

  const getSignalRStatusIcon = () => {
    if (signalRStatus === 'connected') return <Wifi className="w-4 h-4 text-green-600" />;
    if (signalRStatus === 'connecting') return <Loader2 className="w-4 h-4 text-yellow-600 animate-spin" />;
    return <WifiOff className="w-4 h-4 text-red-600" />;
  };

  return (
    <div className="max-w-7xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT PANEL - Chat Section */}
        <div className="lg:col-span-2 flex flex-col" style={{ height: '600px' }}>
          {/* Chat Header */}
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${getStatusColor()}`}></div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">Unified Chat</h2>
                <p className="text-xs text-gray-600">{getStatusText()}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {/* SignalR Status */}
              <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-full">
                {getSignalRStatusIcon()}
                <span className="text-xs text-gray-700">
                  SignalR: {signalRStatus}
                </span>
              </div>
              
              {chatMode !== 'none' && (
                <button
                  onClick={resetChat}
                  className="px-3 py-1 text-sm bg-red-500 text-white rounded-md hover:bg-red-600"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Session Mapping Info (Debug) */}
          {chatMode !== 'none' && (
            <div className="mb-2 p-2 bg-gray-50 rounded text-xs">
              <div className="font-semibold text-gray-700 mb-1">Session Mapping:</div>
              <div className="text-gray-600 space-y-1">
                {sessionMappingRef.current.copilotConversationId && (
                  <div>Copilot ID: {sessionMappingRef.current.copilotConversationId.substring(0, 20)}...</div>
                )}
                {sessionMappingRef.current.serviceNowChatSessionId && (
                  <div>ServiceNow Session: {sessionMappingRef.current.serviceNowChatSessionId.substring(0, 20)}...</div>
                )}
                <div>Context Messages: {sessionMappingRef.current.conversationContext.length}</div>
              </div>
            </div>
          )}

          {/* Messages Container */}
          <div className="flex-1 border border-gray-200 rounded-lg overflow-y-auto bg-gray-50 p-4 mb-4">
            {messages.length === 0 && chatMode === 'none' && (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                <Bot className="w-16 h-16 mb-4 text-gray-400" />
                <p className="text-lg font-semibold mb-2">Welcome to Unified Chat</p>
                <p className="text-sm">Configure settings on the right and click "Start Chat" to begin</p>
              </div>
            )}
            
            {messages.map((message) => (
              <div key={message.id} className={`mb-4 flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex items-start gap-2 max-w-md ${message.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  {/* Avatar */}
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    message.sender === 'user' 
                      ? 'bg-blue-500 text-white' 
                      : message.sender === 'copilot'
                      ? 'bg-purple-500 text-white'
                      : message.sender === 'agent'
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-500 text-white'
                  }`}>
                    {message.sender === 'user' ? (
                      <User className="w-4 h-4" />
                    ) : message.sender === 'copilot' ? (
                      <Bot className="w-4 h-4" />
                    ) : message.sender === 'agent' ? (
                      <UserCheck className="w-4 h-4" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                  </div>
                  
                  {/* Message Bubble */}
                  <div className={`px-4 py-2 rounded-lg ${
                    message.sender === 'user'
                      ? 'bg-blue-500 text-white'
                      : message.sender === 'copilot'
                      ? 'bg-purple-100 text-gray-800 border border-purple-200'
                      : message.sender === 'agent'
                      ? 'bg-green-100 text-gray-800 border border-green-200'
                      : 'bg-yellow-100 text-gray-800 border border-yellow-200'
                  }`}>
                    {message.sender === 'agent' && message.senderProfile && (
                      <div className="text-xs font-semibold mb-1 opacity-75">
                        {message.senderProfile.name}
                      </div>
                    )}
                    <div className="text-sm whitespace-pre-wrap">{message.text}</div>
                    <div className={`text-xs mt-1 opacity-70 ${
                      message.sender === 'user' ? 'text-blue-100' : 'text-gray-600'
                    }`}>
                      {message.timestamp.toLocaleTimeString()}
                    </div>
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
              placeholder={
                chatMode === 'none' 
                  ? 'Start a chat first...' 
                  : chatMode === 'handoff'
                  ? 'Please wait for agent connection...'
                  : 'Type your message...'
              }
              disabled={chatMode === 'none' || chatMode === 'handoff' || isLoading}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
            <button
              onClick={handleSendMessage}
              disabled={chatMode === 'none' || chatMode === 'handoff' || isLoading || !inputMessage.trim()}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Send
            </button>
          </div>
        </div>

        {/* RIGHT PANEL - Configuration */}
        <div className="lg:col-span-1 flex flex-col">
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-800">Configuration</h2>
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              {showConfig ? 'Hide' : 'Show'}
            </button>
          </div>

          {showConfig && (
            <div className="flex-1 overflow-y-auto space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Backend URL:
                </label>
                <input
                  type="text"
                  value={config.backendUrl}
                  onChange={(e) => setConfig({...config, backendUrl: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  disabled={chatMode !== 'none'}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Azure Function URL:
                </label>
                <input
                  type="text"
                  value={config.azureFunctionUrl}
                  onChange={(e) => setConfig({...config, azureFunctionUrl: e.target.value})}
                  placeholder="https://your-app.azurestaticapps.net"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  disabled={chatMode !== 'none'}
                />
                <p className="text-xs text-gray-500 mt-1">Required for SignalR real-time messaging</p>
              </div>

              <div className="border-t pt-4">
                <h3 className="font-semibold text-gray-800 mb-2">ServiceNow Settings:</h3>
                
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      ServiceNow URL:
                    </label>
                    <input
                      type="text"
                      value={config.serviceNowUrl}
                      onChange={(e) => setConfig({...config, serviceNowUrl: e.target.value})}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      disabled={chatMode !== 'none'}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Username:
                    </label>
                    <input
                      type="text"
                      value={config.serviceNowUsername}
                      onChange={(e) => setConfig({...config, serviceNowUsername: e.target.value})}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      disabled={chatMode !== 'none'}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Password:
                    </label>
                    <input
                      type="password"
                      value={config.serviceNowPassword}
                      onChange={(e) => setConfig({...config, serviceNowPassword: e.target.value})}
                      placeholder="Enter password"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      disabled={chatMode !== 'none'}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Token:
                    </label>
                    <input
                      type="text"
                      value={config.serviceNowToken}
                      onChange={(e) => setConfig({...config, serviceNowToken: e.target.value})}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      disabled={chatMode !== 'none'}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Topic ID:
                    </label>
                    <input
                      type="text"
                      value={config.serviceNowTopicId}
                      onChange={(e) => setConfig({...config, serviceNowTopicId: e.target.value})}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      disabled={chatMode !== 'none'}
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={initializeCopilot}
                disabled={isLoading || chatMode !== 'none' || !config.serviceNowPassword}
                className="w-full px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-semibold"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Connecting...
                  </>
                ) : chatMode !== 'none' ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Connected
                  </>
                ) : (
                  'Start Chat'
                )}
              </button>

              {/* Status Info */}
              {chatMode !== 'none' && (
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 text-xs">
                  <h4 className="font-semibold text-blue-800 mb-2">Session Status:</h4>
                  <div className="space-y-1 text-blue-700">
                    {chatMode === 'copilot' && (
                      <>
                        <div>✅ Copilot Connected</div>
                        <div className="text-xs text-blue-600">Waiting for handoff trigger...</div>
                      </>
                    )}
                    {chatMode === 'handoff' && (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Transferring to agent...
                      </div>
                    )}
                    {chatMode === 'agent' && (
                      <>
                        <div>✅ Connected to Live Agent</div>
                        {serviceNowState.chatSessionId && (
                          <div className="text-xs text-blue-600 mt-1">
                            Session: {serviceNowState.chatSessionId.substring(0, 8)}...
                          </div>
                        )}
                        <div className="flex items-center gap-1 mt-2 text-green-600">
                          <CheckCircle className="w-3 h-3" />
                          <span className="text-xs">SignalR active - Real-time messaging enabled</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Instructions */}
          {!showConfig && (
            <div className="flex-1 overflow-y-auto">
              <div className="bg-gray-50 p-4 rounded-lg space-y-3 text-sm">
                <div>
                  <h3 className="font-semibold text-gray-800 mb-2">🎯 How it works:</h3>
                  <ol className="list-decimal list-inside space-y-2 text-gray-700 text-xs">
                    <li>Start chatting - Copilot will respond to your questions</li>
                    <li>When Copilot detects handoff keywords, it will automatically transfer you</li>
                    <li>SignalR establishes real-time connection for agent messages</li>
                    <li>You'll be connected to a ServiceNow live agent with full conversation context</li>
                    <li>Continue chatting with the agent seamlessly via SignalR</li>
                  </ol>
                </div>

                <div className="bg-green-50 p-2 rounded border border-green-200">
                  <h4 className="font-semibold text-green-800 text-xs mb-1">✨ SignalR Features:</h4>
                  <ul className="list-disc list-inside space-y-1 text-green-700 text-xs">
                    <li>Instant message delivery (&lt;1 second)</li>
                    <li>No polling - efficient real-time updates</li>
                    <li>Automatic reconnection on connection loss</li>
                    <li>Group-based message routing (privacy)</li>
                    <li>Exponential backoff retry strategy</li>
                  </ul>
                </div>

                <div className="bg-yellow-50 p-2 rounded border border-yellow-200">
                  <h4 className="font-semibold text-yellow-800 text-xs mb-1">⚠️ Handoff Triggers:</h4>
                  <p className="text-yellow-700 text-xs">
                    Handoff occurs when Copilot's response includes phrases like "transferring you to an agent", 
                    "connect you with an agent", or similar keywords.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UnifiedChatWithHandoff;