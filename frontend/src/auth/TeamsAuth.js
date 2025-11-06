// src/auth/TeamsAuth.js
import * as microsoftTeams from '@microsoft/teams-js';

export class TeamsAuth {
  /**
   * Get authentication token from Teams
   * Returns token with user information
   */
  static async getAuthToken() {
    try {
      await microsoftTeams.app.initialize();
      
      console.log('🔐 Requesting SSO token from Teams...');
      
      // Request SSO token from Teams
      const token = await microsoftTeams.authentication.getAuthToken({
        resources: [],
        silent: false
      });
      
      console.log('✅ Got Teams SSO token');
      return token;
      
    } catch (error) {
      console.error('❌ SSO failed:', error);
      
      // If silent SSO fails, try interactive login
      if (error.message?.includes('CancelledByUser')) {
        throw new Error('User cancelled login');
      }
      
      // Fallback to interactive login
      return await this.interactiveLogin();
    }
  }
  
  /**
   * Interactive login fallback
   */
  static async interactiveLogin() {
    return new Promise((resolve, reject) => {
      microsoftTeams.authentication.authenticate({
        url: window.location.origin + '/auth-start.html',
        width: 600,
        height: 535,
        successCallback: (result) => {
          console.log('✅ Interactive login success');
          resolve(result);
        },
        failureCallback: (reason) => {
          console.error('❌ Interactive login failed:', reason);
          reject(reason);
        }
      });
    });
  }
  
  /**
   * Decode JWT token to get user information
   */
  static getUserInfoFromToken(token) {
    try {
      // Decode JWT token (it's base64 encoded)
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      
      const decoded = JSON.parse(jsonPayload);
      
      // Extract user info
      const email = decoded.preferred_username || decoded.upn || decoded.email;
      const userId = this.extractUserIdFromEmail(email);
      
      return {
        id: decoded.oid || decoded.sub,
        name: decoded.name,
        email: email,
        userId: userId,  // firstname.lastname (without domain)
        tenantId: decoded.tid,
        token: token
      };
      
    } catch (error) {
      console.error('❌ Failed to decode token:', error);
      return null;
    }
  }
  
  /**
   * Extract userId from email
   * firstname.lastname@domain.com → firstname.lastname
   */
  static extractUserIdFromEmail(email) {
    if (!email) return null;
    
    // Split by @ and take the first part
    const userId = email.split('@')[0];
    
    console.log(`📧 Email: ${email} → UserId: ${userId}`);
    
    return userId;
  }
  
  /**
   * Get Teams context (user info without SSO)
   */
  static async getTeamsContext() {
    try {
      await microsoftTeams.app.initialize();
      const context = await microsoftTeams.app.getContext();
      
      const email = context.user?.userPrincipalName;
      const userId = this.extractUserIdFromEmail(email);
      
      return {
        id: context.user?.id,
        name: context.user?.displayName,
        email: email,
        userId: userId,
        tenantId: context.user?.tenant?.id,
        theme: context.app?.theme
      };
    } catch (error) {
      console.error('❌ Failed to get Teams context:', error);
      return null;
    }
  }
  
  /**
   * Call Microsoft Graph API (optional)
   */
  static async callGraphAPI(token) {
    try {
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Graph API call failed');
      }
      
      return await response.json();
      
    } catch (error) {
      console.error('❌ Graph API error:', error);
      return null;
    }
  }
}