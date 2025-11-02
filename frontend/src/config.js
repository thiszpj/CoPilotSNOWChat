const config = {
  AZURE_BASE_URL: 'https://wonderful-sky-0661cc20f.3.azurestaticapps.net',
  AZURE_API_URL: 'https://wonderful-sky-0661cc20f.3.azurestaticapps.net/api',
  
  // Azure App Service URL for Express backend
  AZURE_BACKEND_URL: 'https://copilotsnow-backend-api-exb4e5dtf3gkgjb2.eastus-01.azurewebsites.net',
  
  LOCAL_BACKEND_URL: 'http://localhost:3001',
  
  IS_PRODUCTION: window.location.hostname !== 'localhost',
  
  // 🔧 TOGGLE BACKEND: Uncomment ONE option below
  
  // Option 1: Auto-detect (localhost = local backend, Azure = Azure backend)
  // getBackendUrl: function() {
  //   return this.IS_PRODUCTION ? this.AZURE_BACKEND_URL : this.LOCAL_BACKEND_URL;
  // },
  
  // ✅ Option 2: Force Azure backend (ACTIVE - for testing Azure deployment)
  getBackendUrl: function() {
   return this.AZURE_BACKEND_URL;
  },
  
  // Option 3: Force local backend (always use localhost:3001)
//    getBackendUrl: function() {
//      return this.LOCAL_BACKEND_URL;
//    },
  
  // ServiceNow Configuration
  serviceNow: {
    baseUrl: 'https://dev205527.service-now.com',
    username: 'admin',
    token: 'TGbK5XRDgtmf4rK',
    topicId: 'ce2ee85053130010cf8cddeeff7b12bf'
  },
  
  // ✅ FIXED: Changed to Capital 'L' in "Line" to match UnifiedChatWithHandoff.js
  endpoints: {
    directLineTokenGenerate: '/api/directline/tokens/generate',   // ✅ Capital 'L'
    directLineConversations: '/api/directline/conversations',      // ✅ Capital 'L'
    serviceNowBotIntegration: '/api/servicenow/bot/integration',
    serviceNowGetMessages: '/api/servicenow/get-messages',
    negotiate: '/negotiate'
  }
};

export default config;