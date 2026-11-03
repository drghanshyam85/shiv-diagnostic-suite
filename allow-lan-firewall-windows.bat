@echo off
rem Allows other clinic devices to reach the server on port 3000 (private networks only).
rem Right-click this file and choose "Run as administrator".
net session >nul 2>nul
if errorlevel 1 (
  echo Please right-click this file and choose "Run as administrator".
  pause
  exit /b 1
)
netsh advfirewall firewall delete rule name="SSDC Clinic Suite" >nul 2>nul
netsh advfirewall firewall add rule name="SSDC Clinic Suite" dir=in action=allow protocol=TCP localport=3000 profile=private
rem Stable name (http://shiv-clinic.local:3000) is announced with mDNS on UDP 5353
netsh advfirewall firewall delete rule name="SSDC Clinic Suite mDNS" >nul 2>nul
netsh advfirewall firewall add rule name="SSDC Clinic Suite mDNS" dir=in action=allow protocol=UDP localport=5353 profile=private
echo.
echo Done. Make sure the clinic Wi-Fi / LAN is set to a "Private" network in Windows settings.
echo Other devices can open http://shiv-clinic.local:3000 (name set in Settings - LAN and workstation).
pause
