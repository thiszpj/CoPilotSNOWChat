// API Configuration for Azure deployment
const config = {
  // Azure Static Web App URLs
  AZURE_BASE_URL: 'https://wonderful-sky-0661cc20f.3.azurestaticapps.net',
  AZURE_API_URL: 'https://wonderful-sky-0661cc20f.3.azurestaticapps.net/api',
  
  // Backend URLs (for local development with Express server)
  LOCAL_BACKEND_URL: 'http://localhost:3001',
  
  // Determine if running locally or in production
  IS_PRODUCTION: window.location.hostname !== 'localhost',
  
  // Get the appropriate backend URL based on environment
  getBackendUrl: function() {
    return this.IS_PRODUCTION ? this.AZURE_API_URL : this.LOCAL_BACKEND_URL;
  },
  
  // API Endpoints
  endpoints: {
    // SignalR
    negotiate: '/negotiate',
    
    // ServiceNow
    serviceNowReceiveMessage: '/servicenow/receive-message',
    serviceNowGetMessages: '/servicenow/get-messages',
    
    // Direct Line (via backend proxy) - ADD /api prefix
    directLineTokenGenerate: '/api/directline/tokens/generate',
    directLineConversations: '/api/directline/conversations',
    
    // ServiceNow Bot Integration (via backend proxy) - ADD /api prefix
    serviceNowBotIntegration: '/api/servicenow/bot/integration',
  },
  
  // ServiceNow Configuration
  serviceNow: {
    baseUrl: 'https://dev205527.service-now.com',
    username: 'admin',
    token: 'TGbK5XRDgtmf4rK',
    topicId: 'ce2ee85053130010cf8cddeeff7b12bf'
  }
};

export default config;