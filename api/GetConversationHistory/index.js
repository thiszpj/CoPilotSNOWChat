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
        // Try multiple sources for connection string
        let connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING 
                            || process.env.AzureWebJobsStorage;
        
        if (!connectionString) {
            // For Azure Static Web Apps, storage might be auto-provided
            // Return empty messages if storage not configured yet
            context.log.warn('⚠️ Storage not configured, returning empty messages');
            
            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: {
                    success: true,
                    conversationId: conversationId,
                    messageCount: 0,
                    messages: [],
                    retrievedAt: new Date().toISOString(),
                    note: 'Storage not configured - no messages available'
                }
            };
            return;
        }
        
        const tableName = 'ServiceNowMessages';
        const tableClient = TableClient.fromConnectionString(connectionString, tableName);
        
        // Ensure table exists
        try {
            await tableClient.createTable();
            context.log('✅ Table created or already exists');
        } catch (err) {
            if (err.statusCode !== 409) {
                context.log.warn('Table creation warning:', err.message);
            }
        }
        
        // Query messages
        const messages = [];
        
        try {
            const entities = tableClient.listEntities({
                queryOptions: {
                    filter: `PartitionKey eq '${conversationId}'`
                }
            });
            
            for await (const entity of entities) {
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
        } catch (queryErr) {
            context.log.warn('Query warning:', queryErr.message);
        }
        
        // Sort by timestamp
        messages.sort((a, b) => {
            const dateA = new Date(a.receivedAt || a.timestamp || 0);
            const dateB = new Date(b.receivedAt || b.timestamp || 0);
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