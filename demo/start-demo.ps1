# Lance la démo ColocOS : base de démo, API (3001) et front (4173).
# Usage : powershell -ExecutionPolicy Bypass -File demo\start-demo.ps1
$root = Split-Path -Parent $PSScriptRoot

docker start colocos-demo-db | Out-Null

function Open-Window($title, $dir, $cmd) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command",
        "`$Host.UI.RawUI.WindowTitle='$title'; Set-Location '$dir'; $cmd"
}

Open-Window "COLOCOS - API (3001)" (Join-Path $root "apps\backend") "npm run dev"
Open-Window "COLOCOS - FRONT (4173)" (Join-Path $root "apps\frontend") "npx vite preview --port 4173"

Write-Host "API et front en cours de demarrage : http://localhost:4173"
