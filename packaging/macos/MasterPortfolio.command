#!/bin/bash
# MasterPortfolio launcher (macOS). Double-click to start.
HERE="$(cd "$(dirname "$0")" && pwd)"
# Finder에서 연 .command는 로그인 셸 PATH가 아닐 수 있어 claude가 있는 흔한 위치를 더한다
[ -x /usr/libexec/path_helper ] && eval "$(/usr/libexec/path_helper -s)"
export PATH="$HERE/runtime/bin:$HOME/.local/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:$PATH"
# 처음 연 뒤 내장 실행기에 남은 격리 표시를 지운다(Gatekeeper)
xattr -dr com.apple.quarantine "$HERE" 2>/dev/null || true
printf '\033]0;MasterPortfolio\007'
"$HERE/runtime/bin/node" "$HERE/app/dist/cli.js" start
status=$?
if [ $status -ne 0 ]; then echo; read -n 1 -s -r -p "아무 키나 누르면 창을 닫습니다"; echo; fi
exit $status
