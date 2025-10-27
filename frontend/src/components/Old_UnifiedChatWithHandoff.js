import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Loader2, UserCheck, AlertCircle, CheckCircle } from 'lucide-react';

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
  const [isPollingServiceNow, setIsPollingServiceNow] = useState(false);
  const serviceNowPollIntervalRef = useRef(null);
  const seenMessageIdsRef = useRef(new Set());
  
  // Configuration
  const [config, setConfig] = useState({
    backendUrl: 'http://localhost:3001',
    serviceNowUrl: 'https://dev205527.service-now.com',
    serviceNowUsername: 'admin',
    serviceNowPassword: '',
    serviceNowToken: 'TGbK5XRDgtmf4rK',
    serviceNowTopicId: 'ce2ee85053130010cf8cddeeff7b12bf',
    pollingInterval: 3000
  });
  
  const [showConfig, setShowConfig] = useState(true);
  const messagesEndRef = useRef(null);

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
      if (serviceNowPollIntervalRef.current) {
        clearInterval(serviceNowPollIntervalRef.current);
      }
    };
  }, []);

  // ============== COPILOT FUNCTIONS ==============
  
  const initializeCopilot = async () => {
    setIsLoading(true);
    try {
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
      setCopilotConversationId(conversationData.conversationId);
      
      // Set mode BEFORE starting polling
      setChatMode('copilot');
      chatModeRef.current = 'copilot';
      
      startCopilotPolling(conversationData.conversationId);
      
      addSystemMessage('Connected to Copilot! You can now start chatting.');
      setShowConfig(false);
      
      console.log('🎉 Successfully connected to Copilot!');
      
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
          
          // Check for handoff trigger in new messages
          filteredNew.forEach(msg => {
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
        throw new Error('Failed to send message to Copilot');
      }
    } catch (error) {
      console.error('Error sending message to Copilot:', error);
      addSystemMessage(`Error sending message: ${error.message}`);
    }
  };

  // ============== HANDOFF DETECTION ==============
  
  const checkForHandoffTrigger = (message) => {
    // Check if message contains handoff indicators
    const handoffKeywords = [
      'transferring you to an agent',
      'connect you with an agent',
      'live agent',
      'human agent',
      'transfer to agent',
      'escalate',
      'handoff'
    ];
    
    const messageText = message.text.toLowerCase();
    const currentMode = chatModeRef.current;
    
    console.log('🔍 Checking message for handoff trigger:', messageText);
    console.log('🔍 Current chatMode (ref):', currentMode);
    console.log('🔍 Current chatMode (state):', chatMode);
    
    const shouldHandoff = handoffKeywords.some(keyword => {
      const found = messageText.includes(keyword);
      if (found) {
        console.log('✅ Found handoff keyword:', keyword);
      }
      return found;
    });
    
    console.log('🔍 Should handoff?', shouldHandoff);
    
    if (shouldHandoff && currentMode === 'copilot') {
      console.log('🔔 Handoff trigger detected! Initiating handoff...');
      initiateHandoff();
    } else if (shouldHandoff && currentMode !== 'copilot') {
      console.log('⚠️ Handoff keyword found but chatMode is not copilot. Current mode:', currentMode);
      console.log('⚠️ State says:', chatMode);
    }
  };

  // ============== HANDOFF PROCESS ==============
  
  const initiateHandoff = async () => {
    console.log('🔄 Initiating handoff to ServiceNow...');
    setChatMode('handoff');
    chatModeRef.current = 'handoff';
    addSystemMessage('Connecting you to a live agent, please wait...');
    
    stopCopilotPolling();
    
    // Prepare conversation context for ServiceNow
    const conversationContext = prepareConversationContext();
    
    // Initiate ServiceNow conversation with context
    await initiateServiceNowConversation(conversationContext);
  };

  const prepareConversationContext = () => {
    // Extract conversation history
    const conversationHistory = messages
      .filter(m => m.sender === 'user' || m.sender === 'copilot')
      .map(m => `${m.sender === 'user' ? 'User' : 'Copilot'}: ${m.text}`)
      .join('\n');
    
    return `Previous conversation with Copilot:\n${conversationHistory}\n\nUser is now being transferred to a live agent.`;
  };

  // ============== SERVICENOW FUNCTIONS ==============
  
  const generateRequestId = () => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const generateClientMessageId = () => {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const initiateServiceNowConversation = async (contextMessage) => {
    setIsLoading(true);
    
    try {
      console.log('🔄 Initiating ServiceNow conversation...');
      console.log('📝 Context message:', contextMessage);
      
      const requestId = generateRequestId();
      const clientMessageId = generateClientMessageId();

      const payload = {
        requestId: requestId,
        enterpriseId: "ServiceNow",
        nowBotId: serviceNowState.nowBotId,
        nowSessionId: serviceNowState.nowSessionId,
        topic: config.serviceNowTopicId,
        clientVariables: {},
        message: {
          text: contextMessage,
          typed: false,
          clientMessageId: clientMessageId,
          attachment: null
        },
        timestamp: Math.floor(Date.now() / 1000),
        botToBot: true,
        silentMessage: null,
        intent: null,
        contextVariables: {},
        userId: config.serviceNowUsername,
        emailId: `${config.serviceNowUsername}@example.com`
      };

      console.log('📤 Sending payload to ServiceNow:', JSON.stringify(payload, null, 2));

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

      console.log('📥 ServiceNow response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ ServiceNow response error:', errorText);
        throw new Error(`ServiceNow connection failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('📦 ServiceNow response data:', JSON.stringify(data, null, 2));

      // Extract chatSessionId from the response body array
      let chatSessionId = null;
      let conversationId = null;
      
      // Check in body array for ActionMsg with actionType: "SubscribeToChatPresence"
      if (data.body && Array.isArray(data.body)) {
        const chatPresenceMsg = data.body.find(msg => 
          msg.uiType === 'ActionMsg' && 
          msg.actionType === 'SubscribeToChatPresence'
        );
        
        if (chatPresenceMsg) {
          chatSessionId = chatPresenceMsg.chatSessionId;
          console.log('✅ Found chatSessionId from SubscribeToChatPresence:', chatSessionId);
        }
        
        // Also look for conversationId from StartConversation
        const startConvMsg = data.body.find(msg =>
          msg.uiType === 'ActionMsg' &&
          msg.actionType === 'StartConversation'
        );
        
        if (startConvMsg) {
          conversationId = startConvMsg.conversationId;
          console.log('✅ Found conversationId from StartConversation:', conversationId);
        }
      }
      
      // Fallback to old extraction method
      if (!chatSessionId && data.body?.uiData?.chatSessionId) {
        chatSessionId = data.body.uiData.chatSessionId;
      } else if (!chatSessionId && data.chatSessionId) {
        chatSessionId = data.chatSessionId;
      }

      console.log('🔍 Final extracted chatSessionId:', chatSessionId);
      console.log('🔍 Final extracted conversationId:', conversationId);

      // Use conversationId as chatSessionId if chatSessionId is not found
      if (!chatSessionId && conversationId) {
        chatSessionId = conversationId;
        console.log('✅ Using conversationId as chatSessionId:', chatSessionId);
      }

      if (chatSessionId) {
        setServiceNowState({
          nowBotId: data.nowBotId || 'not-provided',
          nowSessionId: data.nowSessionId || null,
          requestId: requestId,
          chatSessionId: chatSessionId
        });
        
        console.log('✅ ServiceNow Chat Session established:', chatSessionId);
        setChatMode('agent');
        chatModeRef.current = 'agent';
        addSystemMessage('Connected to live agent! You can now chat with a ServiceNow agent.');
        
        setTimeout(() => {
          console.log('🔄 Starting ServiceNow polling...');
          startServiceNowPolling(chatSessionId);
        }, 2000);
      } else {
        console.error('❌ No chatSessionId found in ServiceNow response');
        throw new Error('ServiceNow did not return a chat session ID');
      }

      // Add any text messages from the response
      if (data.body && Array.isArray(data.body)) {
        data.body.forEach((item, index) => {
          if (item.uiType === 'OutputText' && item.value) {
            console.log('💬 Adding ServiceNow message:', item.value);
            const messageId = item.messageId || `initial-${Date.now()}-${index}`;
            
            // Track this message as seen
            seenMessageIdsRef.current.add(messageId);
            
            // Use messageId as unique identifier
            addMessage(item.value, 'agent', { 
              sysId: messageId,
              messageId: item.messageId
            });
          }
        });
      }

    } catch (error) {
      console.error('❌ Failed to connect to ServiceNow:', error);
      console.error('Stack trace:', error.stack);
      addSystemMessage(`Failed to connect to agent: ${error.message}`);
      setChatMode('copilot');
      chatModeRef.current = 'copilot';
      // Only restart Copilot polling if we have a valid conversation ID
      if (copilotConversationId) {
        startCopilotPolling(copilotConversationId);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const startServiceNowPolling = (chatSessionId) => {
    setIsPollingServiceNow(true);
    console.log('🔄 Started polling ServiceNow for agent messages');
    
    fetchServiceNowMessages(chatSessionId);
    
    serviceNowPollIntervalRef.current = setInterval(() => {
      fetchServiceNowMessages(chatSessionId);
    }, config.pollingInterval);
  };

  const stopServiceNowPolling = () => {
    if (serviceNowPollIntervalRef.current) {
      clearInterval(serviceNowPollIntervalRef.current);
      serviceNowPollIntervalRef.current = null;
    }
    setIsPollingServiceNow(false);
  };

  const fetchServiceNowMessages = async (chatSessionId) => {
    try {
      const response = await fetch(`${config.backendUrl}/api/servicenow/get-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceNowUrl: config.serviceNowUrl,
          username: config.serviceNowUsername,
          password: config.serviceNowPassword,
          conversationId: chatSessionId,
          limit: 100
        })
      });

      if (!response.ok) return;

      const data = await response.json();
      
      if (data.result && data.result.length > 0) {
        const latestMessage = data.result[0];
        
        // Check using ref instead of state to avoid stale closure
        const messageId = latestMessage.sys_id;
        
        if (!seenMessageIdsRef.current.has(messageId) && latestMessage.payload) {
          console.log('📨 New agent message received:', latestMessage.payload);
          
          // Add to seen messages
          seenMessageIdsRef.current.add(messageId);
          
          setMessages(prev => [...prev, {
            id: latestMessage.sys_id,
            text: latestMessage.payload,
            sender: 'agent',
            timestamp: new Date(latestMessage.send_time || Date.now()),
            sysId: latestMessage.sys_id,
            messageId: latestMessage.messageId,
            agentName: latestMessage.sys_created_by || 'Agent'
          }]);
        }
      }
    } catch (error) {
      console.error('Error fetching ServiceNow messages:', error);
    }
  };

  const sendMessageToServiceNow = async (text) => {
    try {
      const requestId = generateRequestId();
      const clientMessageId = generateClientMessageId();

      const payload = {
        requestId: requestId,
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
        throw new Error('Failed to send message to ServiceNow');
      }
    } catch (error) {
      console.error('Error sending message to ServiceNow:', error);
      addSystemMessage(`Error sending message: ${error.message}`);
    }
  };

  // ============== MESSAGE HANDLING ==============
  
  const addMessage = (text, sender, extraData = {}) => {
    setMessages(prev => [...prev, {
      id: `${sender}-${Date.now()}`,
      text: text,
      sender: sender,
      timestamp: new Date(),
      ...extraData
    }]);
  };

  const addSystemMessage = (text) => {
    addMessage(text, 'system');
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

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
      if (chatMode === 'copilot') {
        await sendMessageToCopilot(messageToSend);
      } else if (chatMode === 'agent') {
        await sendMessageToServiceNow(messageToSend);
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

  // ============== UI HELPERS ==============
  
  const getModeDisplay = () => {
    switch (chatMode) {
      case 'copilot':
        return { icon: Bot, color: 'blue', text: 'Copilot Bot' };
      case 'handoff':
        return { icon: Loader2, color: 'yellow', text: 'Connecting to Agent...' };
      case 'agent':
        return { icon: UserCheck, color: 'green', text: 'Live Agent' };
      default:
        return { icon: AlertCircle, color: 'gray', text: 'Not Connected' };
    }
  };

  const modeDisplay = getModeDisplay();
  const ModeIcon = modeDisplay.icon;

  return (
    <div className="max-w-7xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT PANEL - Chat Interface */}
        <div className="lg:col-span-2 flex flex-col h-[600px]">
          {/* Header */}
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <ModeIcon className={`w-6 h-6 ${chatMode === 'handoff' ? 'animate-spin' : ''}`} style={{ color: modeDisplay.color === 'blue' ? '#3b82f6' : modeDisplay.color === 'yellow' ? '#eab308' : modeDisplay.color === 'green' ? '#10b981' : '#6b7280' }} />
              <h2 className="text-xl font-bold text-gray-800">Unified Chat</h2>
            </div>
            
            <div className="flex items-center gap-2" style={{ color: modeDisplay.color === 'blue' ? '#3b82f6' : modeDisplay.color === 'yellow' ? '#eab308' : modeDisplay.color === 'green' ? '#10b981' : '#6b7280' }}>
              <div className={`w-2 h-2 rounded-full ${chatMode === 'copilot' || chatMode === 'agent' ? 'animate-pulse' : ''}`} style={{ backgroundColor: modeDisplay.color === 'blue' ? '#3b82f6' : modeDisplay.color === 'yellow' ? '#eab308' : modeDisplay.color === 'green' ? '#10b981' : '#6b7280' }}></div>
              <span className="text-sm font-medium">{modeDisplay.text}</span>
            </div>
          </div>

          {/* Messages Container */}
          <div className="flex-1 border border-gray-200 rounded-lg overflow-y-auto bg-gray-50 p-4 mb-4">
            {messages.length === 0 && chatMode === 'none' && (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                <Bot className="w-12 h-12 mb-4 text-gray-400" />
                <p>Configure your settings and click "Start Chat" to begin</p>
              </div>
            )}
            
            {messages.map((message) => (
              <div key={message.id} className={`mb-4 flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex items-start gap-2 max-w-xs lg:max-w-md ${message.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    message.sender === 'user' 
                      ? 'bg-blue-500 text-white' 
                      : message.sender === 'copilot'
                      ? 'bg-purple-500 text-white'
                      : message.sender === 'agent'
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-500 text-white'
                  }`}>
                    {message.sender === 'user' ? <User className="w-4 h-4" /> : 
                     message.sender === 'agent' ? <UserCheck className="w-4 h-4" /> : 
                     <Bot className="w-4 h-4" />}
                  </div>
                  
                  <div className={`px-3 py-2 rounded-lg ${
                    message.sender === 'user'
                      ? 'bg-blue-500 text-white'
                      : message.sender === 'copilot'
                      ? 'bg-purple-100 text-gray-800 border border-purple-300'
                      : message.sender === 'agent'
                      ? 'bg-green-100 text-gray-800 border border-green-300'
                      : 'bg-gray-200 text-gray-700'
                  }`}>
                    {message.sender === 'agent' && message.agentName && (
                      <div className="text-xs font-semibold text-green-700 mb-1">
                        👤 {message.agentName}
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
              placeholder={chatMode === 'copilot' || chatMode === 'agent' ? "Type your message..." : "Start chat first..."}
              disabled={chatMode !== 'copilot' && chatMode !== 'agent' || isLoading}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
            <button
              onClick={handleSendMessage}
              disabled={chatMode !== 'copilot' && chatMode !== 'agent' || isLoading || !inputMessage.trim()}
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

        {/* RIGHT PANEL - Configuration */}
        <div className="lg:col-span-1 flex flex-col h-[600px]">
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
                  disabled={chatMode === 'copilot' || chatMode === 'agent' || chatMode === 'handoff'}
                />
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
                      disabled={chatMode === 'copilot' || chatMode === 'agent' || chatMode === 'handoff'}
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
                      disabled={chatMode === 'copilot' || chatMode === 'agent' || chatMode === 'handoff'}
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
                      disabled={chatMode === 'copilot' || chatMode === 'agent' || chatMode === 'handoff'}
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
                      disabled={chatMode === 'copilot' || chatMode === 'agent' || chatMode === 'handoff'}
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
                      disabled={chatMode === 'copilot' || chatMode === 'agent' || chatMode === 'handoff'}
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={initializeCopilot}
                disabled={isLoading || chatMode === 'copilot' || chatMode === 'agent' || !config.serviceNowPassword}
                className="w-full px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-semibold"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Connecting...
                  </>
                ) : chatMode === 'copilot' || chatMode === 'agent' ? (
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
                        <div className={`flex items-center gap-1 mt-2 ${isPollingServiceNow ? 'text-green-600' : 'text-gray-600'}`}>
                          <div className={`w-2 h-2 rounded-full ${isPollingServiceNow ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
                          <span className="text-xs">{isPollingServiceNow ? 'Polling active' : 'Polling stopped'}</span>
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
                    <li>You'll be connected to a ServiceNow live agent with full conversation context</li>
                    <li>Continue chatting with the agent seamlessly</li>
                  </ol>
                </div>

                <div className="bg-yellow-50 p-2 rounded border border-yellow-200">
                  <h4 className="font-semibold text-yellow-800 text-xs mb-1">⚠️ Handoff Triggers:</h4>
                  <p className="text-yellow-700 text-xs">
                    Handoff occurs when Copilot's response includes phrases like "transferring you to an agent", 
                    "connect you with an agent", or similar keywords configured in your Copilot topic.
                  </p>
                </div>

                <div className="bg-green-50 p-2 rounded border border-green-200">
                  <h4 className="font-semibold text-green-800 text-xs mb-1">✅ Features:</h4>
                  <ul className="list-disc list-inside space-y-1 text-green-700 text-xs">
                    <li>Automatic handoff detection</li>
                    <li>Full conversation context transfer</li>
                    <li>Real-time agent messaging</li>
                    <li>Visual status indicators</li>
                  </ul>
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