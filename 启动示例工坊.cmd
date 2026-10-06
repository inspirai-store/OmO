@echo off
chcp 65001 >nul
set "WORKSHOP_LIBRARY=%~dp0.data\library"
set "WORKSHOP_CLIENT=%~dp0release\skins-client\win-unpacked\素材工坊.exe"
if not exist "%WORKSHOP_CLIENT%" set "WORKSHOP_CLIENT=%~dp0release\family-client\win-unpacked\素材工坊.exe"
if not exist "%WORKSHOP_CLIENT%" set "WORKSHOP_CLIENT=%~dp0release\processing-organize-client\win-unpacked\素材工坊.exe"
if not exist "%WORKSHOP_CLIENT%" set "WORKSHOP_CLIENT=%~dp0release\processing-input-fix\win-unpacked\素材工坊.exe"
if not exist "%WORKSHOP_CLIENT%" set "WORKSHOP_CLIENT=%~dp0release\processing-client\win-unpacked\素材工坊.exe"
if not exist "%WORKSHOP_CLIENT%" set "WORKSHOP_CLIENT=%~dp0release\readability-client\win-unpacked\素材工坊.exe"
if not exist "%WORKSHOP_CLIENT%" set "WORKSHOP_CLIENT=%~dp0release\generation-client\win-unpacked\素材工坊.exe"
if not exist "%WORKSHOP_CLIENT%" set "WORKSHOP_CLIENT=%~dp0release\p5s-client\win-unpacked\素材工坊.exe"
if not exist "%WORKSHOP_CLIENT%" set "WORKSHOP_CLIENT=%~dp0release\win-unpacked\素材工坊.exe"
start "" "%WORKSHOP_CLIENT%"
