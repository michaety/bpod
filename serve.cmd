@echo off
cd /d "%~dp0site"
echo Serving at http://localhost:8931
"C:\Users\micha\AppData\Local\Programs\Python\Python310\python.exe" -m http.server 8931
