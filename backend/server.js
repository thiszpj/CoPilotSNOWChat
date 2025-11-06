// server.js - Express backend to proxy Direct Line API calls
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // npm install node-fetch@2
const https = require('https'); // Native Node.js HTTPS module
require('dotenv').config(); // npm install dotenv
console.log('DEBUG: process.env.DIRECTLINE_SECRET =', process.env.DIRECTLINE_SECRET);
console.log('DEBUG: process.env.DIRECTLINE_SECRET =', process.env.SERVICENOW_USERNAME);
console.log('DEBUG: process.env.DIRECTLINE_SECRET =', process.env.SERVICENOW_PASSWORD);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Store active conversations (in production, use a proper database)
const conversations = new Map();

// Your Direct Line secret - store this in environment variables
const DIRECTLINE_SECRET = process.env.DIRECTLINE_SECRET || 'YOUR_DIRECTLINE_SECRET_HERE';
const SERVICENOW_USERNAME = process.env.SERVICENOW_USERNAME;
const SERVICENOW_PASSWORD = process.env.SERVICENOW_PASSWORD;


console.log('🚀 Starting Direct Line proxy server...');
console.log(`📡 Port: ${PORT}`);
console.log(`🔑 Direct Line Secret: ${DIRECTLINE_SECRET.substring(0, 10)}...`);

// Health check endpoint
app.get('/api/health', (req, res) => {
  console.log('📊 Health check requested');
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    port: PORT,
    hasSecret: !!DIRECTLINE_SECRET && DIRECTLINE_SECRET !== 'YOUR_DIRECTLINE_SECRET_HERE'
  });
});

// Generate Direct Line token (recommended approach)
app.post('/api/directline/tokens/generate', async (req, res) => {
  console.log('🔑 Generating Direct Line token...');
  console.log('🔍 Secret (first 10 chars):', DIRECTLINE_SECRET.substring(0, 10));
  console.log('🔍 Secret (last 20 chars):', DIRECTLINE_SECRET.substring(DIRECTLINE_SECRET.length - 20));
  console.log('🔍 Secret length:', DIRECTLINE_SECRET.length);
  try {
    if (!DIRECTLINE_SECRET || DIRECTLINE_SECRET === 'YOUR_DIRECTLINE_SECRET_HERE') {
      throw new Error('Direct Line secret not configured. Please set DIRECTLINE_SECRET in .env file');
    }

    const response = await fetch('https://directline.botframework.com/v3/directline/tokens/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DIRECTLINE_SECRET}`,
        'Content-Type': 'application/json'
      }
      
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Token generation error:', response.status, errorText);
      throw new Error(`Token generation error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('✅ Token generated successfully');
    res.json(data);
  } catch (error) {
    console.error('❌ Error generating token:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Initialize Direct Line conversation (using token)
app.post('/api/directline/conversations', async (req, res) => {
  console.log('🔄 Initializing Direct Line conversation...');
  console.log('📋 Request body:', req.body);
  
  try {
    const { token } = req.body;
    
    if (!token) {
      console.error('❌ No token provided in request body');
      throw new Error('Token is required. Generate a token first using /api/directline/tokens/generate');
    }

    console.log('🔑 Using token:', token.substring(0, 20) + '...');

    const response = await fetch('https://directline.botframework.com/v3/directline/conversations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Direct Line API error:', response.status, errorText);
      throw new Error(`Direct Line API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Store conversation info with the token
    conversations.set(data.conversationId, {
      token: token, // Use the generated token
      watermark: '',
      created: new Date()
    });

    console.log('✅ Conversation initialized:', data.conversationId);
    res.json(data);
  } catch (error) {
    console.error('❌ Error initializing Direct Line:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Send message to bot (using stored token)
app.post('/api/directline/conversations/:conversationId/activities', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const conversation = conversations.get(conversationId);
    
    console.log('📤 Sending message to bot:', req.body.text);
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const response = await fetch(`https://directline.botframework.com/v3/directline/conversations/${conversationId}/activities`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${conversation.token}`, // Use the stored token
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Error sending message:', response.status, errorText);
      throw new Error(`Direct Line API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('✅ Message sent successfully');
    res.json(data);
  } catch (error) {
    console.error('❌ Error sending message:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get messages from bot (using stored token)
app.get('/api/directline/conversations/:conversationId/activities', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { watermark } = req.query;
    const conversation = conversations.get(conversationId);
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const url = `https://directline.botframework.com/v3/directline/conversations/${conversationId}/activities${watermark ? `?watermark=${watermark}` : ''}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${conversation.token}` // Use the stored token
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Direct Line API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Update watermark
    if (data.watermark) {
      conversation.watermark = data.watermark;
    }
    
    // Only log if there are new messages
    if (data.activities && data.activities.length > 0) {
      console.log('📥 Received messages:', data.activities.length);
    }
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error getting messages:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ServiceNow Bot Integration Proxy - Using native HTTPS
app.post('/api/servicenow/bot/integration', (req, res) => {
    const requestId = Date.now();
    console.log(`📄 [${requestId}] ServiceNow Bot Integration proxy called`);
    
    try {
        // ✅ CHANGED: Get credentials from environment, not request body
        const username = SERVICENOW_USERNAME;
        const password = SERVICENOW_PASSWORD;
        
        // Validate credentials are configured
        if (!username || !password) {
            console.error('❌ ServiceNow credentials not configured in environment');
            return res.status(500).json({ 
                error: 'ServiceNow credentials not configured on server' 
            });
        }
        
        // ✅ CHANGED: Get other params from request (removed username, password)
        const { serviceNowUrl, token, payload } = req.body;
        
        console.log(`🔍 [${requestId}] Using credentials from environment`);
        console.log(`🔍 [${requestId}] Username:`, username);
        
        // Validate required parameters
        if (!serviceNowUrl || !token || !payload) {
            console.error('❌ Missing required parameters');
            return res.status(400).json({ 
                error: 'Missing required parameters: serviceNowUrl, token, payload' 
            });
        }
        
        // Create Basic Auth header
        const authString = Buffer.from(`${username}:${password}`).toString('base64');
        console.log(`🔐 [${requestId}] Basic Auth string:`, authString);
        console.log(`📤 [${requestId}] Sending request to ServiceNow`);
        console.log(`🔑 [${requestId}] Using token:`, token.substring(0, 10) + '...');
        console.log(`📋 [${requestId}] Payload:`, JSON.stringify(payload, null, 2));
        
        const postData = JSON.stringify(payload);
        
        const options = {
            hostname: 'dev205527.service-now.com',
            path: '/api/sn_va_as_service/bot/integration',
            method: 'POST',
            headers: {
                'Token': token,
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        console.log(`🔤 [${requestId}] Request headers:`, {
            'Token': token.substring(0, 20) + '...',
            'Authorization': 'Basic [HIDDEN]',
            'Content-Type': 'application/json'
        });
        console.log(`📤 [${requestId}] Using native HTTPS module`);
        
        const serviceNowReq = https.request(options, (serviceNowRes) => {
            let data = '';
            
            serviceNowRes.on('data', (chunk) => {
                data += chunk;
            });
            
            serviceNowRes.on('end', () => {
                console.log(`📥 [${requestId}] ServiceNow response status:`, serviceNowRes.statusCode);
                
                if (serviceNowRes.statusCode !== 200) {
                    console.error(`❌ [${requestId}] ServiceNow API error:`, serviceNowRes.statusCode, data);
                    return res.status(serviceNowRes.statusCode).json({
                        error: `ServiceNow API error: ${serviceNowRes.statusCode}`,
                        details: data
                    });
                }
                
                try {
                    const jsonData = JSON.parse(data);
                    console.log(`✅ [${requestId}] ServiceNow response received:`, JSON.stringify(jsonData, null, 2));
                    res.json(jsonData);
                } catch (e) {
                    console.error(`❌ [${requestId}] Failed to parse response:`, e.message);
                    res.status(500).json({ error: 'Failed to parse response' });
                }
            });
        });
        
        serviceNowReq.on('error', (error) => {
            console.error(`❌ [${requestId}] Request error:`, error.message);
            res.status(500).json({ error: error.message });
        });
        
        serviceNowReq.write(postData);
        serviceNowReq.end();
        
    } catch (error) {
        console.error(`❌ [${requestId}] ServiceNow proxy error:`, error.message);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message 
        });
    }
});

// ServiceNow Get Messages Proxy - Polls for agent messages in a specific conversation
app.post('/api/servicenow/get-messages', async (req, res) => {
    console.log('🔍 ServiceNow Get Messages proxy called');
    
    try {
        // ✅ CHANGED: Get credentials from environment
        const username = SERVICENOW_USERNAME;
        const password = SERVICENOW_PASSWORD;
        
        // Validate credentials are configured
        if (!username || !password) {
            console.error('❌ ServiceNow credentials not configured in environment');
            return res.status(500).json({ 
                error: 'ServiceNow credentials not configured on server' 
            });
        }
        
        // ✅ CHANGED: Get other params from request (removed username, password)
        const { serviceNowUrl, conversationId, limit } = req.body;
        
        // Validate required parameters
        if (!serviceNowUrl || !conversationId) {
            console.error('❌ Missing required parameters');
            return res.status(400).json({ 
                error: 'Missing required parameters: serviceNowUrl, conversationId' 
            });
        }
        
        // Create Basic Auth header
        const authString = Buffer.from(`${username}:${password}`).toString('base64');
        
        // Build query string with conversation filter included
        const query = `q_data_message_type=systemTextMessage^direction=outbound^is_agent=true^conversation=${conversationId}^ORDERBYDESCsend_time`;
        const queryLimit = limit || 100;
        const url = `${serviceNowUrl}/api/now/table/sys_cs_message?sysparm_query=${encodeURIComponent(query)}&sysparm_limit=${queryLimit}`;
        
        console.log('📤 Fetching messages from ServiceNow');
        console.log('🔑 Conversation ID:', conversationId);
        console.log('🔍 Query:', query);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${authString}`,
                'Accept': 'application/json'
            }
        });
        
        console.log('📥 ServiceNow response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ ServiceNow API error:', response.status, errorText);
            return res.status(response.status).json({ 
                error: `ServiceNow API error: ${response.status}`,
                details: errorText 
            });
        }
        
        const data = await response.json();
        console.log('✅ ServiceNow messages received:', data.result?.length || 0, 'messages');
        
        // Log first few messages for debugging
        if (data.result && data.result.length > 0) {
            console.log('📋 Sample messages:');
            data.result.slice(0, 3).forEach((msg, index) => {
                console.log(`  Message ${index + 1}:`, {
                    sys_id: msg.sys_id,
                    conversation: msg.conversation?.value || msg.conversation,
                    is_agent: msg.is_agent,
                    direction: msg.direction,
                    payload: msg.payload?.substring(0, 50) + '...',
                    send_time: msg.send_time
                });
            });
        }
        
        res.json(data);
        
    } catch (error) {
        console.error('❌ ServiceNow get messages error:', error.message);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message 
        });
    }
})

// Clean up old conversations (run periodically)
setInterval(() => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  
  for (const [id, conversation] of conversations.entries()) {
    if (conversation.created < oneHourAgo) {
      conversations.delete(id);
      console.log('🧹 Cleaned up old conversation:', id);
    }
  }
}, 15 * 60 * 1000); // Run every 15 minutes

app.listen(PORT, () => {
  console.log('');
  console.log('🎉 ================================');
  console.log(`✅ Direct Line proxy server running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🤖 Ready to proxy Direct Line API calls!`);
  if (!DIRECTLINE_SECRET || DIRECTLINE_SECRET === 'YOUR_DIRECTLINE_SECRET_HERE') {
    console.log('⚠️  WARNING: Direct Line secret not configured!');
    console.log('   Please set DIRECTLINE_SECRET in your .env file');
  }
  console.log('🎉 ================================');
  console.log('');
});

// Export for testing
module.exports = app;