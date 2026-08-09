const { execSync } = require('child_process');

const PORT = 3005;

function killPort(port) {
  try {
    const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    const lines = result.trim().split('\n');
    const pids = new Set();

    lines.forEach(line => {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      const state = parts[3];
      // Kill LISTENING and ESTABLISHED — skip TIME_WAIT (OS manages those)
      if (pid && pid !== '0' && state !== 'TIME_WAIT') {
        pids.add(pid);
      }
    });

    if (pids.size === 0) {
      console.log(`[CleanPort] Port ${port} is already clear.`);
      return;
    }

    pids.forEach(pid => {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        console.log(`[CleanPort] Terminated PID ${pid} on port ${port}`);
      } catch (e) {
        // Already dead — ignore
      }
    });

    // Wait 500ms for OS to fully release the port before server starts
    const start = Date.now();
    while (Date.now() - start < 500) {}
    console.log(`[CleanPort] Port ${port} is clear.`);

  } catch (e) {
    // findstr returns exit code 1 when no matches — means port is clear
    console.log(`[CleanPort] Port ${port} is already clear.`);
  }
}

killPort(PORT);
