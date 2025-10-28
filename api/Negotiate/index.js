module.exports = async function (context, req, connectionInfo) {
    context.log('🔗 SignalR Negotiate function called');
    
    context.res = {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: connectionInfo
    };
    
    context.log('✅ SignalR connection info provided');
};