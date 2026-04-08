@echo off
echo ============================================
echo   쿠팡 크롤러용 Chrome 디버그 모드 시작
echo ============================================
echo.
echo Chrome을 디버그 모드(포트 9222)로 시작합니다.
echo 이 창을 닫지 마세요!
echo.

:: 이미 실행 중인 Chrome 확인
tasklist /FI "IMAGENAME eq chrome.exe" 2>NUL | find /I /N "chrome.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [경고] Chrome이 이미 실행 중입니다!
    echo 모든 Chrome 창을 닫고 다시 실행해주세요.
    echo.
    pause
    exit /b 1
)

:: Chrome 경로 자동 탐지
set "CHROME_PATH="

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
)
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
)

if "%CHROME_PATH%"=="" (
    echo [오류] Chrome을 찾을 수 없습니다!
    echo Chrome을 설치하거나 경로를 직접 지정해주세요.
    pause
    exit /b 1
)

echo Chrome 경로: %CHROME_PATH%
echo.

:: 디버그용 임시 프로필로 Chrome 시작
start "" "%CHROME_PATH%" ^
    --remote-debugging-port=9222 ^
    --user-data-dir="%TEMP%\chrome-coupang-debug" ^
    --no-first-run ^
    --disable-default-apps ^
    --new-window ^
    "https://www.coupang.com"

echo Chrome이 시작되었습니다!
echo.
echo [다음 단계]
echo   1. Chrome에서 쿠팡이 정상적으로 열리는지 확인
echo   2. 새 터미널에서: npm run crawl
echo.
echo 크롤링이 끝나면 이 Chrome을 닫아주세요.
pause
