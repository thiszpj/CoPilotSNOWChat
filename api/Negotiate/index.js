/**
 * SignalR Negotiate Function
 * 
 * This function provides connection information for clients to connect to Azure SignalR Service.
 * Clients must call this endpoint first to get the connection URL and access token.
 */

module.exports = async function (context, req, connectionInfo) {
    context.log('🤝 Client negotiating SignalR connection');
    
    // Return connection info to client
    return {
        body: connectionInfo,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    };
};