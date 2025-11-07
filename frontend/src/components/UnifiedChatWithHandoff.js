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
  const userInfoRef = useRef(null);  // Add ref to persist userInfo
  
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
            userInfoRef.current = userInfo;  // Store in ref too
            
            // Add welcome message
            const welcomeMessage = {
              id: `welcome-${Date.now()}`,
              text: `Hello ${userInfo.name || 'there'}! 👋 Welcome to Support Chat. I'm your AI assistant. How can I help you today?`,
              sender: 'bot',
              timestamp: new Date()
            };
            setMessages([welcomeMessage]);
          } else {
            // Fallback to basic context
            console.log('⚠️ Using basic Teams context');
            setUserInfo(context);
            
            // Add welcome message with basic context
            const welcomeMessage = {
              id: `welcome-${Date.now()}`,
              text: `Hello ${context.name || 'there'}! 👋 Welcome to Support Chat. I'm your AI assistant. How can I help you today?`,
              sender: 'bot',
              timestamp: new Date()
            };
            setMessages([welcomeMessage]);
          }
        } catch (ssoError) {
          console.log('⚠️ SSO not available, using basic context');
          setUserInfo(context);
          
          // Add welcome message with basic context
          const welcomeMessage = {
            id: `welcome-${Date.now()}`,
            text: `Hello ${context.name || 'there'}! 👋 Welcome to Support Chat. I'm your AI assistant. How can I help you today?`,
            sender: 'bot',
            timestamp: new Date()
          };
          setMessages([welcomeMessage]);
        }
      } else {
        console.log('ℹ️ Not running in Teams');
        setIsInTeams(false);
        
        // Add generic welcome for browser
        const welcomeMessage = {
          id: `welcome-${Date.now()}`,
          text: `Hello! 👋 Welcome to Support Chat. I'm your AI assistant. How can I help you today?`,
          sender: 'bot',
          timestamp: new Date()
        };
        setMessages([welcomeMessage]);
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
      console.log('👤 Current userInfo:', userInfo);
      
      setChatMode('handoff');
      chatModeRef.current = 'handoff';
      
      if (!signalRConnectionRef.current || signalRStatus !== 'connected') {
        await initializeSignalR();
      }
      
      if (copilotPollIntervalRef.current) {
        clearInterval(copilotPollIntervalRef.current);
      }
      
      // Use userInfo with proper fallback
      const currentUserInfo = userInfoRef.current || userInfo;
      const userId = currentUserInfo?.userId || sessionId;
      const userEmail = currentUserInfo?.email || `${sessionId}@example.com`;
      
      console.log('📧 Using userId:', userId);
      console.log('📧 Using email:', userEmail);
      
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
        userId: userId,
        emailId: userEmail
        // Removed userName - not in your ideal payload
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
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: '#FFFFFF' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4" style={{ borderColor: '#5B5FC7' }}></div>
          <p style={{ color: '#616161' }}>Authenticating...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: '#FFFFFF' }}>
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ backgroundColor: '#FFFFFF' }}>
        <div className="max-w-3xl mx-auto space-y-3">
          {messages.map((message) => {
            if (message.sender === 'user') {
              return (
                <div key={message.id} className="flex justify-end mb-2">
                  <div className="flex flex-col items-end max-w-lg">
                    <div style={{ backgroundColor: '#E4E6FA', color: '#242424' }} className="px-4 py-2 rounded-lg">
                      <p className="text-sm whitespace-pre-wrap break-words">{message.text}</p>
                    </div>
                    <span className="text-xs mt-1" style={{ color: '#616161' }}>{formatTime(message.timestamp)}</span>
                  </div>
                </div>
              );
            }

            if (message.sender === 'bot' || message.sender === 'agent') {
              return (
                <div key={message.id} className="flex justify-start mb-2">
                  <div className="flex items-start space-x-2 max-w-lg">
                    {/* Avatar Icon */}
                    <div className="flex-shrink-0 mt-1">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: message.sender === 'bot' ? '#5B5FC7' : '#107C10' }}>
                        {message.sender === 'bot' ? (
                          // Robot icon for Copilot
                          <svg className="w-5 h-5" style={{ color: '#FFFFFF' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        ) : (
                          // Person icon for Agent
                          <svg className="w-5 h-5" style={{ color: '#FFFFFF' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex flex-col">
                      {/* Name and timestamp on same line */}
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="text-xs font-semibold" style={{ color: '#242424' }}>
                          {message.sender === 'agent' && message.agentName ? message.agentName : 'AI Assistant'}
                        </span>
                        <span className="text-xs" style={{ color: '#616161' }}>{formatTime(message.timestamp)}</span>
                      </div>
                      
                      {/* Message bubble */}
                      <div style={{ backgroundColor: '#F5F5F5', color: '#242424' }} className="px-4 py-2 rounded-lg">
                        <p className="text-sm whitespace-pre-wrap break-words">{message.text}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            return null;
          })}

          {isLoading && (
            <div className="flex justify-start mb-2">
              <div className="flex items-start space-x-2">
                {/* Robot icon */}
                <div className="flex-shrink-0 mt-1">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: '#5B5FC7' }}>
                    <svg className="w-5 h-5" style={{ color: '#FFFFFF' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                </div>
                
                <div className="flex flex-col">
                  <div className="px-4 py-3 rounded-lg" style={{ backgroundColor: '#F5F5F5' }}>
                    <div className="flex space-x-1.5">
                      <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#616161', animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#616161', animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#616161', animationDelay: '300ms' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t px-4 py-3" style={{ backgroundColor: '#FFFFFF', borderColor: '#E0E0E0' }}>
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end space-x-2">
            <div className="flex-1 relative">
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message"
                rows={1}
                className="w-full px-3 py-2 pr-10 border rounded focus:outline-none resize-none"
                style={{ 
                  minHeight: '36px', 
                  maxHeight: '120px',
                  borderColor: '#E0E0E0',
                  color: '#242424',
                  fontSize: '14px'
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!inputMessage.trim() || isLoading}
                className="absolute right-2 bottom-2 p-1.5 rounded transition-colors"
                style={{
                  backgroundColor: 'transparent',
                  color: inputMessage.trim() && !isLoading ? '#5B5FC7' : '#C4C4C4'
                }}
              >
                {/* Right arrow like Teams */}
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/>
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