$ErrorActionPreference = 'Stop'
# MasterPortfolio 설치: 이 폴더를 %LOCALAPPDATA%\Programs\MasterPortfolio로 복사하고 바탕화면·시작 메뉴 바로가기를 만든다.
$src = Split-Path -Parent $PSScriptRoot
$dst = Join-Path $env:LOCALAPPDATA 'Programs\MasterPortfolio'
Write-Host ''
Write-Host 'MasterPortfolio 설치' -ForegroundColor Cyan
if ((Resolve-Path $src).Path.TrimEnd('\') -ieq $dst.TrimEnd('\')) {
  Write-Host '이미 설치 위치에서 실행 중입니다. 바로가기만 다시 만듭니다.'
} else {
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
  Write-Host "설치 위치: $dst"
}
$ws = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($dir in $places) {
  $lnk = $ws.CreateShortcut((Join-Path $dir 'MasterPortfolio.lnk'))
  $lnk.TargetPath = Join-Path $dst 'MasterPortfolio.cmd'
  $lnk.WorkingDirectory = $dst
  $lnk.IconLocation = (Join-Path $dst 'MasterPortfolio.ico') + ',0'
  $lnk.Description = '흩어진 자료에서 이력서·포트폴리오 경험을 찾아 정리'
  $lnk.Save()
}
Write-Host ''
Write-Host '설치를 마쳤습니다. 바탕화면 또는 시작 메뉴의 MasterPortfolio를 실행하세요.' -ForegroundColor Green
Write-Host '(분석에는 이 PC에 설치·로그인된 Claude Code가 필요합니다)'
