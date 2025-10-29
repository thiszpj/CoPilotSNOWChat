// API Configuration for Azure deployment
const config = {
  AZURE_BASE_URL: 'https://wonderful-sky-0661cc20f.3.azurestaticapps.net',
  AZURE_API_URL: 'https://wonderful-sky-0661cc20f.3.azurestaticapps.net/api',
  
  // ADD THIS: Azure App Service URL for Express backend
  AZURE_BACKEND_URL: 'https://copilotsnow-backend-api-exb4e5dtf3gkgjb2.eastus-01.azurewebsites.net',
  
  LOCAL_BACKEND_URL: 'http://localhost:3001',
  
  IS_PRODUCTION: window.location.hostname !== 'localhost',
  
  getBackendUrl: function() {
    // Use Azure backend when in production, localhost when local
    return this.IS_PRODUCTION ? this.AZURE_BACKEND_URL : this.LOCAL_BACKEND_URL;
  },
  
  // API Endpoints
  endpoints: {
    // SignalR
    negotiate: '/negotiate',
    
    // ServiceNow
    serviceNowReceiveMessage: '/servicenow/receive-message',
    serviceNowGetMessages: '/servicenow/get-messages',
    
    // Direct Line (via backend proxy)
    directLineTokenGenerate: '/directline/tokens/generate',
    directLineConversations: '/directline/conversations',
    
    // ServiceNow Bot Integration (via backend proxy)
    serviceNowBotIntegration: '/servicenow/bot/integration',
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