const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
    context.log('📥 Getting conversation history');
    
    const conversationId = req.query.conversationId || (req.body && req.body.conversationId);
    
    if (!conversationId) {
        context.res = {
            status: 400,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: { 
                success: false,
                error: 'conversationId is required as query parameter or in body' 
            }
        };
        return;
    }
    
    try {
        const connectionString = process.env.AzureWebJobsStorage;
        const tableName = 'ServiceNowMessages';
        
        const tableClient = TableClient.fromConnectionString(connectionString, tableName);
        
        // Ensure table exists
        await tableClient.createTable().catch(() => {
            context.log('Table already exists or created');
        });
        
        // Query messages for this conversation
        const messages = [];
        const entities = tableClient.listEntities({
            queryOptions: {
                filter: `PartitionKey eq '${conversationId}'`
            }
        });
        
        for await (const entity of entities) {
            // Parse senderProfile if it's a string
            let senderProfile = entity.senderProfile;
            if (typeof senderProfile === 'string') {
                try {
                    senderProfile = JSON.parse(senderProfile);
                } catch (e) {
                    context.log.warn('Could not parse senderProfile');
                }
            }
            
            messages.push({
                messageId: entity.RowKey,
                conversationId: entity.conversationId || entity.PartitionKey,
                chatSessionId: entity.chatSessionId,
                createdOn: entity.createdOn,
                createdBy: entity.createdBy,
                messageType: entity.messageType,
                messageText: entity.messageText,
                eventType: entity.eventType,
                avatarDisplayed: entity.avatarDisplayed,
                notifyUser: entity.notifyUser,
                senderProfile: senderProfile,
                receivedAt: entity.receivedAt,
                source: entity.source,
                timestamp: entity.timestamp
            });
        }
        
        // Sort by timestamp (oldest first)
        messages.sort((a, b) => {
            const dateA = new Date(a.receivedAt || a.timestamp);
            const dateB = new Date(b.receivedAt || b.timestamp);
            return dateA - dateB;
        });
        
        context.log(`✅ Found ${messages.length} messages for conversation ${conversationId}`);
        
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                success: true,
                conversationId: conversationId,
                messageCount: messages.length,
                messages: messages,
                retrievedAt: new Date().toISOString()
            }
        };
        
    } catch (error) {
        context.log.error('❌ Error retrieving conversation history:', error);
        
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                success: false,
                error: error.message,
                conversationId: conversationId,
                timestamp: new Date().toISOString()
            }
        };
    }
};