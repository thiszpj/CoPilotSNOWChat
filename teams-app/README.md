# Teams App Deployment Guide

This folder contains everything needed to deploy your Copilot Support Chat to Microsoft Teams.

## 📁 Files

- `manifest.json` - Teams app configuration
- `color.png` - 192x192px color icon (need to create)
- `outline.png` - 32x32px outline icon (need to create)
- `create-icons.ps1` - Script to generate placeholder icons

## 🚀 Quick Start

### Step 1: Create Icons

You need two PNG icons:

**Option A: Use Placeholder Icons (for testing)**
1. Run the PowerShell script:
   ```powershell
   cd C:\Project\copilot-directline-project\teams-app
   .\create-icons.ps1
   ```
2. Convert the generated SVG files to PNG:
   - Go to https://cloudconvert.com/svg-to-png
   - Upload `color.svg` → Download as `color.png` (192x192)
   - Upload `outline.svg` → Download as `outline.png` (32x32)

**Option B: Create Your Own Icons**
- Create `color.png` - 192x192 pixels (full color company logo)
- Create `outline.png` - 32x32 pixels (white outline on transparent background)

### Step 2: Package the App

```powershell
cd C:\Project\copilot-directline-project\teams-app

# Make sure you have: manifest.json, color.png, outline.png
# Then create the package:
Compress-Archive -Path manifest.json,color.png,outline.png -DestinationPath CopilotSupportApp.zip -Force
```

### Step 3: Deploy to Teams

**Option A: Sideload (For Testing)**
1. Open Microsoft Teams
2. Click **Apps** in the left sidebar
3. Click **Manage your apps** (bottom left)
4. Click **Upload an app** → **Upload a custom app**
5. Select `CopilotSupportApp.zip`
6. Click **Add** to install for yourself

**Option B: Teams Developer Portal (Recommended)**
1. Go to https://dev.teams.microsoft.com/
2. Sign in with your Microsoft account
3. Click **Apps** → **Import app**
4. Upload `CopilotSupportApp.zip`
5. Review and **Distribute** to your organization

**Option C: Admin Center (Organization-wide)**
1. Go to Teams Admin Center (admin.teams.microsoft.com)
2. Navigate to **Teams apps** → **Manage apps**
3. Click **Upload new app** → Upload custom app
4. Upload `CopilotSupportApp.zip`
5. Set permissions and approve for your organization

## 🔧 Update Your React App for Teams

### Install Teams SDK

```powershell
cd C:\Project\copilot-directline-project\frontend
npm install @microsoft/teams-js
```

### Add Teams Initialization

In `UnifiedChatWithHandoff.js`, add at the top:

```javascript
import * as microsoftTeams from '@microsoft/teams-js';

// Inside your component:
useEffect(() => {
  // Initialize Teams SDK
  microsoftTeams.app.initialize().then(() => {
    console.log('✅ Running in Microsoft Teams');
    
    // Get Teams context (optional)
    microsoftTeams.app.getContext().then((context) => {
      console.log('Teams User:', context.user?.userPrincipalName);
      // You can use this for SSO or user identification
    });
  }).catch((error) => {
    console.log('Running in standalone mode (not Teams)');
  });
}, []);
```

### Deploy Updated Frontend

```powershell
cd C:\Project\copilot-directline-project
git add .
git commit -m "Add Microsoft Teams support"
git push
```

## 📋 Testing Checklist

- [ ] Icons created (color.png and outline.png)
- [ ] Zip package created
- [ ] App uploaded to Teams
- [ ] App appears in Teams Apps list
- [ ] Can open the app in Teams
- [ ] Chat interface loads correctly
- [ ] Can start chat with Copilot
- [ ] Handoff to ServiceNow works
- [ ] SignalR messages appear
- [ ] Can send follow-up messages

## 🐛 Troubleshooting

### App doesn't appear in Teams
- Check that your organization allows custom apps
- Admin may need to approve the app first
- Try uploading again with a new version number in manifest.json

### Blank screen in Teams
- Check browser console (F12) for errors
- Verify `validDomains` in manifest.json includes all your domains
- Make sure HTTPS is working on your Azure Static Web App

### SignalR not connecting
- Add SignalR domain to `validDomains` in manifest.json
- Check network tab for CORS errors

### Icons not showing
- Verify icon files are exactly 192x192 and 32x32 pixels
- Check file names match manifest.json exactly
- Icons must be PNG format

## 📝 Manifest Details

**App ID:** `57ad0c0b-469b-41ea-dca0-be67b0f5cae4`
**Package Name:** `com.copilotsnow.supportchat`
**Version:** `1.0.0`

To update the app:
1. Increment version in manifest.json (e.g., 1.0.0 → 1.0.1)
2. Recreate the zip package
3. Re-upload to Teams

## 🔐 Security Notes

- The app runs in an iframe within Teams
- All authentication should work as normal
- ServiceNow password is still entered by user (secure)
- Teams context can provide user identity for SSO (optional enhancement)

## 📚 Resources

- [Teams Developer Documentation](https://docs.microsoft.com/microsoftteams/platform/)
- [Teams JavaScript SDK](https://docs.microsoft.com/javascript/api/overview/msteams-client)
- [App Manifest Reference](https://docs.microsoft.com/microsoftteams/platform/resources/schema/manifest-schema)
- [Icon Guidelines](https://docs.microsoft.com/microsoftteams/platform/concepts/build-and-test/apps-package#app-icons)

## 🎯 Next Steps (Optional)

1. **Single Sign-On (SSO)** - Use Teams user identity
2. **Adaptive Cards** - Rich message formatting
3. **Proactive Messaging** - Send notifications to users
4. **Bot Integration** - Add conversational bot interface
5. **Meeting Extension** - Use during Teams meetings
