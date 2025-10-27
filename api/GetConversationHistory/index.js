/**
 * Azure Function: Get Conversation History
 * 
 * Retrieves stored messages for a specific conversation from Azure Table Storage
 * Useful for loading conversation history or auditing
 * 
 * Query Parameters:
 * - conversationId (required): The conversation ID to retrieve messages for
 * - limit (optional): Maximum number of messages to return (default: 100)
 * - orderBy (optional): 'asc' or 'desc' (default: 'desc' - newest first)
 */

const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
    context.log('📚 Retrieving conversation history');
    
    // Set CORS headers
    context.res = {
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
    };

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
        context.res.status = 200;
        context.res.body = {};
        return;
    }

    try {
        // Get query parameters
        const conversationId = req.query.conversationId || req.body?.conversationId;
        const limit = parseInt(req.query.limit || req.body?.limit || '100');
        const orderBy = req.query.orderBy || req.body?.orderBy || 'desc';

        // Validate conversation ID
        if (!conversationId) {
            context.res.status = 400;
            context.res.body = {
                error: 'Bad Request',
                message: 'conversationId is required',
                usage: 'GET /api/servicenow/get-messages?conversationId=YOUR_ID'
            };
            return;
        }

        context.log(`📖 Fetching messages for conversation: ${conversationId}`);

        // Get messages from Table Storage
        const messages = await getMessagesFromTableStorage(conversationId, limit, orderBy, context);

        context.log(`✅ Retrieved ${messages.length} messages`);

        // Return success response
        context.res.status = 200;
        context.res.body = {
            success: true,
            conversationId: conversationId,
            messageCount: messages.length,
            messages: messages,
            retrievedAt: new Date().toISOString()
        };

    } catch (error) {
        context.log.error('❌ Error retrieving messages:', error);
        
        context.res.status = 500;
        context.res.body = {
            error: 'Internal Server Error',
            message: 'Failed to retrieve messages',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        };
    }
};

/**
 * Retrieve messages from Azure Table Storage
 */
async function getMessagesFromTableStorage(conversationId, limit, orderBy, context) {
    try {
        const connectionString = process.env.AzureWebJobsStorage;
        
        if (!connectionString) {
            throw new Error('AzureWebJobsStorage connection string not configured');
        }

        const tableName = 'ServiceNowMessages';
        const tableClient = TableClient.fromConnectionString(connectionString, tableName);

        // Query messages for this conversation
        // PartitionKey = conversationId groups all messages for a conversation
        const entities = tableClient.listEntities({
            queryOptions: {
                filter: `PartitionKey eq '${conversationId}'`
            }
        });

        const messages = [];
        for await (const entity of entities) {
            messages.push({
                messageId: entity.messageId,
                conversationId: entity.conversationId,
                createdOn: entity.createdOn,
                createdBy: entity.createdBy,
                messageType: entity.messageType,
                messageText: entity.messageText,
                eventType: entity.eventType,
                avatarDisplayed: entity.avatarDisplayed,
                notifyUser: entity.notifyUser,
                receivedAt: entity.receivedAt,
                source: entity.source,
                timestamp: entity.timestamp
            });

            // Limit results
            if (messages.length >= limit) {
                break;
            }
        }

        // Sort messages
        messages.sort((a, b) => {
            const dateA = new Date(a.receivedAt);
            const dateB = new Date(b.receivedAt);
            return orderBy === 'asc' ? dateA - dateB : dateB - dateA;
        });

        context.log(`✅ Found ${messages.length} messages in table storage`);

        return messages;

    } catch (error) {
        context.log.error('❌ Table Storage query error:', error);
        throw error;
    }
}