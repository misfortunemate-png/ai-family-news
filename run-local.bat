@echo off
if "%DRY_RUN%"=="" set DRY_RUN=1
node scripts\collect.mjs
node scripts\select.mjs
node scripts\stats.mjs
