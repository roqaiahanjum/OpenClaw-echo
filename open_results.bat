@echo off
echo Opening Benchmark Results...
start "" "%~dp0view_results.html"
explorer.exe "%~dp0benchmark_results"
exit
