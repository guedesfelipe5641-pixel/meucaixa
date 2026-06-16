@echo off
echo.
echo =========================================
echo  MeuCaixa - Deploy Firestore Rules
echo =========================================
echo.
cd /d "%~dp0"
echo Pasta: %CD%
echo.
echo Fazendo deploy das regras do Firestore...
firebase deploy --only firestore:rules
echo.
if %ERRORLEVEL% EQU 0 (
    echo [OK] Deploy concluido com sucesso!
) else (
    echo [ERRO] Falha no deploy. Verifique se o Firebase CLI esta instalado e se voce esta logado.
    echo Execute: firebase login
)
echo.
pause
