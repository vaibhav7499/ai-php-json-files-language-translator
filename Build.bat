docker compose build --no-cache && docker compose up -d

@echo off
echo Creating required folders...

mkdir input 2>nul
mkdir output 2>nul

echo Folders ready.