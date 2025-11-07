// src/auth/TeamsAuth.js
import * as microsoftTeams from '@microsoft/teams-js';

export class TeamsAuth {
  /**
   * Get authentication token from Teams SSO
   */
  static async getAuthToken() {
    try {
      await microsoftTeams.app.initialize();
      
      console.log('🔐 Requesting SSO token from Teams...');
      
      const token = await microsoftTeams.authentication.getAuthToken({
        resources: [],
        silent: false
      });
      
      console.log('✅ Got Teams SSO token');
      return token;
      
    } catch (error) {
      console.error('❌ SSO failed:', error);
      
      if (error.message?.includes('CancelledByUser')) {
        throw new Error('User cancelled login');
      }
      
      return await this.interactiveLogin();
    }
  }
  
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
  
  static getUserInfoFromToken(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      
      const decoded = JSON.parse(jsonPayload);
      const email = decoded.preferred_username || decoded.upn || decoded.email;
      const userId = this.extractUserIdFromEmail(email);
      
      return {
        id: decoded.oid || decoded.sub,
        name: decoded.name,
        email: email,
        userId: userId,
        tenantId: decoded.tid,
        token: token
      };
      
    } catch (error) {
      console.error('❌ Failed to decode token:', error);
      return null;
    }
  }
  
  static extractUserIdFromEmail(email) {
    if (!email) return null;
    const userId = email.split('@')[0];
    console.log(`📧 Email: ${email} → UserId: ${userId}`);
    return userId;
  }
  
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
}