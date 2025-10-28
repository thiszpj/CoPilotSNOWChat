module.exports = async function (context, req) {
    context.log('🔔 ServiceNow message received');
    
    try {
        // Validate webhook token for security
        const webhookSecret = process.env.SERVICENOW_WEBHOOK_SECRET;
        const receivedToken = req.headers['x-servicenow-token'];
        
        if (webhookSecret && receivedToken !== webhookSecret) {
            context.log.error('❌ Invalid webhook token');
            context.res = {
                status: 401,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: { 
                    success: false,
                    error: 'Unauthorized: Invalid token' 
                }
            };
            return;
        }
        
        // Extract message data from ServiceNow
        const messageData = req.body;
        context.log('📦 Message data received:', JSON.stringify(messageData, null, 2));
        
        // Validate required fields
        if (!messageData.conversationId && !messageData.conversation_id) {
            throw new Error('Missing conversationId in request');
        }
        
        const conversationId = messageData.conversationId || messageData.conversation_id;
        const messageId = messageData.messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Parse payload if it's a string
        let parsedPayload = {};
        if (messageData.payload) {
            try {
                parsedPayload = typeof messageData.payload === 'string' 
                    ? JSON.parse(messageData.payload) 
                    : messageData.payload;
            } catch (e) {
                context.log.warn('⚠️ Could not parse payload, using as-is');
                parsedPayload = { message: messageData.payload };
            }
        }
        
        // Construct normalized message
        const normalizedMessage = {
            messageId: messageId,
            conversationId: conversationId,
            chatSessionId: messageData.chatSessionId || conversationId,
            createdOn: messageData.created_on || messageData.createdOn || new Date().toISOString(),
            createdBy: messageData.created_by || messageData.createdBy || 'agent',
            messageType: parsedPayload.type || messageData.messageType || 'Text',
            messageText: parsedPayload.message || messageData.message || '',
            eventType: parsedPayload.eventType || messageData.eventType || null,
            avatarDisplayed: parsedPayload.avatarDisplayed !== undefined ? parsedPayload.avatarDisplayed : true,
            notifyUser: parsedPayload.notifyUser !== undefined ? parsedPayload.notifyUser : true,
            senderProfile: messageData.senderProfile || {
                id: messageData.created_by || messageData.createdBy || 'agent',
                name: messageData.created_by || messageData.createdBy || 'Agent',
                type: 'agent'
            },
            rawPayload: JSON.stringify(messageData),
            receivedAt: new Date().toISOString(),
            source: 'servicenow',
            timestamp: new Date().toISOString()
        };
        
        context.log('📝 Normalized message:', JSON.stringify(normalizedMessage, null, 2));
        
        // Store in Table Storage (using output binding)
        context.bindings.messageTable = {
            PartitionKey: conversationId,
            RowKey: messageId,
            conversationId: normalizedMessage.conversationId,
            chatSessionId: normalizedMessage.chatSessionId,
            messageId: normalizedMessage.messageId,
            createdOn: normalizedMessage.createdOn,
            createdBy: normalizedMessage.createdBy,
            messageType: normalizedMessage.messageType,
            messageText: normalizedMessage.messageText,
            eventType: normalizedMessage.eventType,
            avatarDisplayed: normalizedMessage.avatarDisplayed,
            notifyUser: normalizedMessage.notifyUser,
            senderProfile: JSON.stringify(normalizedMessage.senderProfile),
            rawPayload: normalizedMessage.rawPayload,
            receivedAt: normalizedMessage.receivedAt,
            source: normalizedMessage.source
        };
        
        context.log('💾 Message queued for Table Storage');
        
        // Broadcast via SignalR to specific conversation group (using output binding)
        context.bindings.signalRMessages = [{
            target: 'newMessage',
            arguments: [normalizedMessage],
            groupName: `conversation_${conversationId}`
        }];
        
        context.log(`📡 Message queued for SignalR broadcast to group: conversation_${conversationId}`);
        
        // Return success response
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                success: true,
                messageId: messageId,
                conversationId: conversationId,
                receivedAt: normalizedMessage.receivedAt,
                message: 'Message received, stored, and broadcasted successfully'
            }
        };
        
        context.log('✅ Request completed successfully');
        
    } catch (error) {
        context.log.error('❌ Error processing ServiceNow message:', error);
        context.log.error('Stack trace:', error.stack);
        
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                success: false,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            }
        };
    }
};