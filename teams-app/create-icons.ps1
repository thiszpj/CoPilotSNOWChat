# PowerShell script to create placeholder icons for Teams app

Write-Host "Creating Teams app icons..." -ForegroundColor Green

# Create color icon (192x192) - placeholder
$colorIcon = @"
<svg width="192" height="192" xmlns="http://www.w3.org/2000/svg">
  <rect width="192" height="192" fill="#6264A7"/>
  <circle cx="96" cy="70" r="30" fill="white"/>
  <path d="M 60 110 Q 96 90 132 110 L 132 140 Q 96 160 60 140 Z" fill="white"/>
  <text x="96" y="175" font-family="Arial" font-size="16" fill="white" text-anchor="middle">Support</text>
</svg>
"@
$colorIcon | Out-File -FilePath "color.svg" -Encoding utf8

# Create outline icon (32x32) - placeholder  
$outlineIcon = @"
<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
  <circle cx="16" cy="12" r="5" fill="none" stroke="white" stroke-width="2"/>
  <path d="M 10 18 Q 16 15 22 18 L 22 24 Q 16 27 10 24 Z" fill="none" stroke="white" stroke-width="2"/>
</svg>
"@
$outlineIcon | Out-File -FilePath "outline.svg" -Encoding utf8

Write-Host "✅ Icon files created (SVG format)" -ForegroundColor Green
Write-Host "Note: For production, convert SVG to PNG using an online tool like:" -ForegroundColor Yellow
Write-Host "  https://cloudconvert.com/svg-to-png" -ForegroundColor Yellow
Write-Host "  - color.svg → color.png (192x192)" -ForegroundColor Yellow  
Write-Host "  - outline.svg → outline.png (32x32)" -ForegroundColor Yellow
