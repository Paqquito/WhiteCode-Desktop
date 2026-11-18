[Setup]
AppId={#BundleId}.desktop
AppName={#Product}
AppVersion={#Version}
DefaultDirName={localappdata}\Programs\{#Slug}
DefaultGroupName={#Product}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#Stage}-installer
OutputBaseFilename={#Slug}-Setup-{#Version}
SetupIconFile={#Stage}\{#Slug}.ico
UninstallDisplayIcon={app}\{#Slug}.exe
Compression=lzma2
SolidCompression=yes
DisableProgramGroupPage=yes

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#Product}"; Filename: "{app}\{#Slug}.exe"
