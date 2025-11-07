import React, { useState, useEffect, useRef } from 'react';
import * as signalR from '@microsoft/signalr';
import { TeamsAuth } from '../auth/TeamsAuth';
import config from '../config';

const UnifiedChatWithHandoff = () => {
  // ============== STATE MANAGEMENT ==============
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  
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
  
  // User info with SSO
  const [userInfo, setUserInfo] = useState(null);
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

  // ============== SSO INITIALIZATION ==============
  useEffect(() => {
    initializeWithSSO();
  }, []);

  const initializeWithSSO = async () => {
    try {
      setIsAuthenticating(true);
      
      // Get Teams context first
      const context = await TeamsAuth.getTeamsContext();
      
      if (context) {
        console.log('✅ Running in Teams');
        setIsInTeams(true);
        
        // Try SSO authentication
        try {
          const token = await TeamsAuth.getAuthToken();
          const userInfo = TeamsAuth.getUserInfoFromToken(token);
          
          if (userInfo) {
            console.log('✅ SSO successful:', userInfo);
            setUserInfo(userInfo);
          } else {
            // Fallback to basic context
            console.log('⚠️ Using basic Teams context');
            setUserInfo(context);
          }
        } catch (ssoError) {
          console.log('⚠️ SSO not available, using basic context');
          setUserInfo(context);
        }
      } else {
        console.log('ℹ️ Not running in Teams');
        setIsInTeams(false);
      }
      
    } catch (error) {
      console.error('❌ Authentication error:', error);
    } finally {
      setIsAuthenticating(false);
      
      // Auto-start chat after authentication
      setTimeout(() => {
        initializeCopilot();
      }, 500);
    }
  };

  // ============== SCROLL TO BOTTOM ==============
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // ============== COPILOT FUNCTIONS ==============
  const initializeCopilot = async () => {
    if (chatMode !== 'none') return;
    
    try {
      setIsLoading(true);

      const tokenResponse = await fetch(`${config.getBackendUrl()}${config.endpoints.directLineTokenGenerate}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!tokenResponse.ok) throw new Error('Failed to generate token');
      const { token } = await tokenResponse.json();

      const convResponse = await fetch(`${config.getBackendUrl()}${config.endpoints.directLineConversations}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token: token })
      });

      if (!convResponse.ok) throw new Error('Failed to create conversation');
      const convData = await convResponse.json();

      setCopilotConversationId(convData.conversationId);
      sessionMappingRef.current.copilotConversationId = convData.conversationId;

      setChatMode('copilot');
      chatModeRef.current = 'copilot';

      startCopilotPolling(convData.conversationId);

    } catch (error) {
      console.error('❌ Copilot initialization failed:', error);
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
      
      if (!signalRConnectionRef.current || signalRStatus !== 'connected') {
        await initializeSignalR();
      }
      
      if (copilotPollIntervalRef.current) {
        clearInterval(copilotPollIntervalRef.current);
      }
      
      const userId = userInfo?.userId || sessionId;
      const userEmail = userInfo?.email || `${sessionId}@example.com`;
      const userName = userInfo?.name || 'Guest User';
      
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const clientMessageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const payload = {
        requestId: requestId,
        enterpriseId: "ServiceNow",
        nowBotId: null,
        nowSessionId: null,
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
        userId: userId,
        emailId: userEmail,
        userName: userName
      };
      
      console.log('📤 Handoff payload:', payload);
      
      const response = await fetch(`${config.getBackendUrl()}${config.endpoints.serviceNowBotIntegration}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          serviceNowUrl: config.serviceNow.baseUrl,
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

      const chatSessionId = data.body?.find(
        item => item.actionType === 'SubscribeToChatPresence'
      )?.chatSessionId || data.chatSessionId;

      if (!chatSessionId) {
        throw new Error('Failed to extract chatSessionId');
      }

      console.log('🔑 Chat Session ID:', chatSessionId);

      setServiceNowState({
        nowBotId: data.nowBotId || null,
        nowSessionId: data.nowSessionId || null,
        requestId: requestId,
        chatSessionId: chatSessionId
      });

      sessionMappingRef.current.serviceNowChatSessionId = chatSessionId;

      await joinSignalRGroup(chatSessionId);

      setChatMode('agent');
      chatModeRef.current = 'agent';

    } catch (error) {
      console.error('❌ ServiceNow handoff failed:', error);
      setChatMode('copilot');
      chatModeRef.current = 'copilot';
    }
  };

  const sendToServiceNow = async (messageText) => {
    try {
      const userId = userInfo?.userId || sessionId;
      const clientMessageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
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
        userId: userId
      };
      
      console.log('📤 Sending message to ServiceNow:', payload);
      
      await fetch(`${config.getBackendUrl()}${config.endpoints.serviceNowBotIntegration}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          serviceNowUrl: config.serviceNow.baseUrl,
          token: config.serviceNow.token,
          payload: payload
        })
      });
      
      console.log('✅ Message sent successfully');
      
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
        ? `${config.AZURE_BASE_URL}/api/negotiate`
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
        throw new Error('Failed to join group');
      }
      
      console.log(`✅ Successfully joined SignalR group`);
      
    } catch (error) {
      console.error('❌ Error joining SignalR group:', error);
    }
  };

  const handleSignalRMessage = (message) => {
    console.log('📨 SignalR message received:', message);

    const messageId = message.messageId || message.id || `signalr-${Date.now()}`;

    if (seenMessageIdsRef.current.has(messageId)) {
      console.log('⏭️ Duplicate message, skipping');
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
  if (isAuthenticating) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Authenticating...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-3xl mx-auto space-y-3">
          {messages.map((message) => {
            if (message.sender === 'user') {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="flex flex-col items-end max-w-lg">
                    <div className="bg-blue-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm shadow-sm">
                      <p className="text-sm whitespace-pre-wrap break-words">{message.text}</p>
                    </div>
                    <span className="text-xs text-gray-500 mt-1 mr-1">{formatTime(message.timestamp)}</span>
                  </div>
                </div>
              );
            }

            if (message.sender === 'bot' || message.sender === 'agent') {
              return (
                <div key={message.id} className="flex justify-start">
                  <div className="flex flex-col max-w-lg">
                    <div className="bg-white px-4 py-2.5 rounded-2xl rounded-tl-sm shadow-sm border border-gray-200">
                      {message.sender === 'agent' && message.agentName && (
                        <p className="text-xs font-semibold text-gray-600 mb-1">{message.agentName}</p>
                      )}
                      <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">{message.text}</p>
                    </div>
                    <span className="text-xs text-gray-500 mt-1 ml-1">{formatTime(message.timestamp)}</span>
                  </div>
                </div>
              );
            }

            return null;
          })}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white px-4 py-3 rounded-2xl shadow-sm border border-gray-200">
                <div className="flex space-x-1.5">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-white border-t border-gray-200 px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end space-x-2">
            <div className="flex-1 relative">
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                rows={1}
                className="w-full px-4 py-2.5 pr-12 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                style={{ minHeight: '44px', maxHeight: '120px' }}
              />
              <button
                onClick={sendMessage}
                disabled={!inputMessage.trim() || isLoading}
                className="absolute right-2 bottom-2 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnifiedChatWithHandoff;