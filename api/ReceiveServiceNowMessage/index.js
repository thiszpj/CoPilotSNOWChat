/**
 * Azure Function: ServiceNow Message Receiver
 * 
 * Receives POST requests from ServiceNow when messages are sent
 * Stores messages in Azure Table Storage for later retrieval
 * Broadcasts to connected clients via SignalR (optional)
 * 
 * Expected ServiceNow Payload:
 * {
 *   "created_on": "2025-10-23 12:05:10",
 *   "created_by": "live1", 
 *   "conversation_id": "e394cac547fc7210a72797da116d436e",
 *   "payload": "{\"type\":\"System\",\"message\":\"Agent has ended the conversation.\",\"avatarDisplayed\":true,\"notifyUser\":false,\"eventType\":\"ChatEnded\"}"
 * }
 */

const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");

module.exports = async function (context, req) {
    context.log('🔔 ServiceNow message received');
    
    // Set CORS headers for ServiceNow
    context.res = {
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-ServiceNow-Token'
        }
    };

    // Handle OPTIONS preflight request
    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        context.res.body = {};
        return;
    }

    try {
        // Validate request method
        if (req.method !== 'POST') {
            context.res.status = 405;
            context.res.body = {
                error: 'Method not allowed',
                message: 'Only POST requests are accepted'
            };
            return;
        }

        // Optional: Validate authentication token
        const authToken = req.headers['x-servicenow-token'] || req.headers['authorization'];
        const expectedToken = process.env.SERVICENOW_WEBHOOK_SECRET;
        
        if (expectedToken && authToken !== expectedToken && authToken !== `Bearer ${expectedToken}`) {
            context.log.error('❌ Invalid authentication token');
            context.res.status = 401;
            context.res.body = {
                error: 'Unauthorized',
                message: 'Invalid authentication token'
            };
            return;
        }

        // Parse request body
        const messageData = req.body;
        
        if (!messageData) {
            context.res.status = 400;
            context.res.body = {
                error: 'Bad Request',
                message: 'Request body is required'
            };
            return;
        }

        context.log('📨 Processing message:', JSON.stringify(messageData, null, 2));

        // Validate required fields
        const requiredFields = ['created_on', 'created_by', 'conversation_id', 'payload'];
        const missingFields = requiredFields.filter(field => !messageData[field]);
        
        if (missingFields.length > 0) {
            context.res.status = 400;
            context.res.body = {
                error: 'Bad Request',
                message: `Missing required fields: ${missingFields.join(', ')}`,
                requiredFields: requiredFields
            };
            return;
        }

        // Parse the payload string to JSON
        let parsedPayload;
        try {
            parsedPayload = typeof messageData.payload === 'string' 
                ? JSON.parse(messageData.payload) 
                : messageData.payload;
        } catch (parseError) {
            context.log.error('❌ Failed to parse payload:', parseError);
            parsedPayload = { raw: messageData.payload };
        }

        // Create normalized message object
        const normalizedMessage = {
            messageId: generateMessageId(),
            conversationId: messageData.conversation_id,
            createdOn: messageData.created_on,
            createdBy: messageData.created_by,
            messageType: parsedPayload.type || 'Unknown',
            messageText: parsedPayload.message || '',
            eventType: parsedPayload.eventType || null,
            avatarDisplayed: parsedPayload.avatarDisplayed || false,
            notifyUser: parsedPayload.notifyUser !== false,
            rawPayload: JSON.stringify(parsedPayload),
            receivedAt: new Date().toISOString(),
            source: 'servicenow'
        };

        context.log('✅ Normalized message:', JSON.stringify(normalizedMessage, null, 2));

        // Store in Azure Table Storage
        const storageResult = await storeMessageInTableStorage(normalizedMessage, context);
        
        if (!storageResult.success) {
            throw new Error(`Storage failed: ${storageResult.error}`);
        }

        context.log('✅ Message stored in Table Storage');

        // Optionally broadcast via SignalR (if binding is configured)
        if (context.bindings.signalRMessages !== undefined) {
            context.bindings.signalRMessages = [{
                target: 'newMessage',
                arguments: [normalizedMessage]
            }];
            
            // Also send to conversation-specific group
            context.bindings.signalRMessages.push({
                target: 'newMessage',
                arguments: [normalizedMessage],
                groupName: `conversation_${messageData.conversation_id}`
            });
            
            context.log('✅ Message broadcasted via SignalR');
        }

        // Return success response
        context.res.status = 200;
        context.res.body = {
            success: true,
            messageId: normalizedMessage.messageId,
            conversationId: normalizedMessage.conversationId,
            storedAt: storageResult.timestamp,
            message: 'Message received and stored successfully'
        };

    } catch (error) {
        context.log.error('❌ Error processing message:', error);
        
        context.res.status = 500;
        context.res.body = {
            error: 'Internal Server Error',
            message: 'Failed to process message',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        };
    }
};

/**
 * Store message in Azure Table Storage
 */
async function storeMessageInTableStorage(message, context) {
    try {
        // Get Table Storage connection string from environment
        const connectionString = process.env.AzureWebJobsStorage;
        
        if (!connectionString) {
            throw new Error('AzureWebJobsStorage connection string not configured');
        }

        // Create table client
        const tableName = 'ServiceNowMessages';
        const tableClient = TableClient.fromConnectionString(connectionString, tableName);
        
        // Ensure table exists (creates if not exists)
        await tableClient.createTable().catch(() => {
            // Table might already exist, which is fine
        });

        // Create entity for Table Storage
        // PartitionKey: conversation_id (groups messages by conversation)
        // RowKey: messageId (unique identifier)
        const entity = {
            partitionKey: message.conversationId,
            rowKey: message.messageId,
            conversationId: message.conversationId,
            messageId: message.messageId,
            createdOn: message.createdOn,
            createdBy: message.createdBy,
            messageType: message.messageType,
            messageText: message.messageText,
            eventType: message.eventType || '',
            avatarDisplayed: message.avatarDisplayed,
            notifyUser: message.notifyUser,
            rawPayload: message.rawPayload,
            receivedAt: message.receivedAt,
            source: message.source,
            timestamp: new Date()
        };

        // Insert entity
        await tableClient.createEntity(entity);
        
        context.log('✅ Entity stored in table:', tableName);
        
        return {
            success: true,
            timestamp: entity.timestamp.toISOString()
        };
        
    } catch (error) {
        context.log.error('❌ Table Storage error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Generate unique message ID
 */
function generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}