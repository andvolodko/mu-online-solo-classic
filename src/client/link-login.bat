@echo off
setlocal EnableDelayedExpansion

REM --- Detect emcc compiler in PATH, EMSDK, or %USERPROFILE%\emsdk ---
where emcc >nul 2>nul
if errorlevel 1 (
  if defined EMSDK (
    if exist "%EMSDK%\emsdk_env.bat" call "%EMSDK%\emsdk_env.bat" >nul 2>nul
  )
)
where emcc >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\emsdk\emsdk_env.bat" (
    call "%USERPROFILE%\emsdk\emsdk_env.bat" >nul 2>nul
  ) else if exist "C:\emsdk\emsdk_env.bat" (
    call "C:\emsdk\emsdk_env.bat" >nul 2>nul
  )
)
where emcc >nul 2>nul
if errorlevel 1 (
  echo Error: emcc compiler not found in PATH or EMSDK.
  echo Please install and activate Emscripten SDK: https://emscripten.org
  exit /b 1
)

set "CLIENT_DIR=%~dp0"
if "%CLIENT_DIR:~-1%"=="\" set "CLIENT_DIR=%CLIENT_DIR:~0,-1%"
for %%I in ("%CLIENT_DIR%\..\..") do set "REPO_ROOT=%%~fI"

set "OUT=%CLIENT_DIR%\out"
set "PROOF=%CLIENT_DIR%\proof"
set "DATA=%CLIENT_DIR%\Client\Data"
set "CONFIG=%CLIENT_DIR%\Client\Config.ini"
set "WEB=%REPO_ROOT%\web"

if not exist "%OUT%\all" mkdir "%OUT%\all"
if not exist "%PROOF%" mkdir "%PROOF%"

set INC=-I "%CLIENT_DIR%\browser" -I "%CLIENT_DIR%\browser\compat" -I "%CLIENT_DIR%\src" -I "%CLIENT_DIR%\lib\libjpeg\jpeg-6b" -I "%CLIENT_DIR%\lib\miniaudio"

emcc -c -std=c++17 -O2 -ferror-limit=10 -Wno-macro-redefined -Wno-ignored-attributes -Wno-deprecated-non-prototype -Wno-c++11-narrowing %INC% "%CLIENT_DIR%\browser\shell_login.cpp" -o "%OUT%\all\browser_shell_login.o"
if errorlevel 1 ( echo COMPILE_SHELL_FAIL & exit /b 1 )
emcc -c -std=c++17 -O2 -ferror-limit=10 -Wno-macro-redefined -Wno-ignored-attributes -Wno-deprecated-non-prototype -Wno-c++11-narrowing %INC% "%CLIENT_DIR%\browser\net_ws.cpp" -o "%OUT%\all\browser_net_ws.o"
if errorlevel 1 ( echo COMPILE_NET_FAIL & exit /b 1 )
emcc -c -std=c++17 -O2 -ferror-limit=10 -Wno-macro-redefined -Wno-ignored-attributes -Wno-deprecated-non-prototype -Wno-c++11-narrowing %INC% "%CLIENT_DIR%\browser\mu_mesh_draw.cpp" -o "%OUT%\all\browser_mu_mesh_draw.o"
if errorlevel 1 ( echo COMPILE_MESH_FAIL & exit /b 1 )

del "%PROOF%\login-objs.txt" 2>nul
for %%F in ("%OUT%\all\*.o") do (
  set "P=%%~fF"
  set "P=!P:\=/!"
  echo !P!>> "%PROOF%\login-objs.txt"
)

emcc -std=c++17 --profiling-funcs -sEMULATE_FUNCTION_POINTER_CASTS=1 -ferror-limit=30 -sDEFAULT_TO_CXX -Wno-macro-redefined -Wno-ignored-attributes -Wno-deprecated-non-prototype -Wno-c++11-narrowing %INC% @"%PROOF%\login-objs.txt" -o "%OUT%\shell_login.js" -sLEGACY_GL_EMULATION -sGL_FFP_ONLY -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 -sINITIAL_MEMORY=536870912 -sSTACK_SIZE=8388608 -sFORCE_FILESYSTEM=1 -sALLOW_MEMORY_GROWTH=0 -sEXPORTED_RUNTIME_METHODS=HEAPU8 --preload-file "%DATA%@/Data" --preload-file "%CONFIG%@/config.ini" -Wl,--error-limit=0 > "%PROOF%\login-link.txt" 2>&1
if errorlevel 1 (
  echo LINK_FAIL
  type "%PROOF%\login-link.txt"
  exit /b 1
)
echo LINK_OK

powershell -NoProfile -File "%CLIENT_DIR%\patch-login-page.ps1" -Token login103
if errorlevel 1 (
  echo PATCH_FAIL
  exit /b 1
)

copy /y "%OUT%\shell_login.wasm" "%WEB%\shell_login.wasm" >nul
copy /y "%OUT%\shell_login.js" "%WEB%\shell_login.js" >nul
copy /y "%OUT%\shell_login.data" "%WEB%\shell_login.data" >nul
rem copy /y "%OUT%\shell_login.html" "%WEB%\index.html" >nul
echo COPIED_TO_WEB
exit /b 0
