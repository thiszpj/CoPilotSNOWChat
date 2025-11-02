module.exports = async function (context, req) {
    context.log('📥 JoinGroup function called');
    
    try {
        const { connectionId, groupName } = req.body;
        
        if (!connectionId || !groupName) {
            context.log.error('❌ Missing required parameters');
            context.res = {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: { 
                    success: false,
                    error: 'Missing connectionId or groupName' 
                }
            };
            return;
        }
        
        context.log(`🔗 Adding connection ${connectionId} to group ${groupName}`);
        
        // Add connection to group using SignalR output binding
        context.bindings.signalRGroupActions = {
            "action": "add",
            "groupName": groupName,
            "connectionId": connectionId
        };
        
        context.log(`✅ Connection added to group ${groupName}`);
        
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                success: true,
                groupName: groupName,
                connectionId: connectionId,
                message: `Connection ${connectionId} added to group ${groupName}`
            }
        };
        
    } catch (error) {
        context.log.error('❌ Error joining group:', error);
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
                stack: error.stack
            }
        };
    }
};