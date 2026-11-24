$ErrorActionPreference = 'Continue'
# MasterPortfolio 제거: 프로그램 폴더와 바로가기만 지운다. 결과 폴더(문서\MasterPortfolio 등)는 남긴다.
Start-Sleep -Milliseconds 500
$dst = Join-Path $env:LOCALAPPDATA 'Programs\MasterPortfolio'
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $p = Join-Path $dir 'MasterPortfolio.lnk'
  if (Test-Path $p) { Remove-Item $p -Force }
}
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
Write-Host 'MasterPortfolio를 제거했습니다. 결과 폴더와 카드는 그대로 남아 있습니다.' -ForegroundColor Green
Read-Host '닫으려면 Enter'
