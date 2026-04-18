const { execSync } = require('child_process');

/**
 * kill-port.js
 * Automatically detects and terminates any process running on port 3005 (Windows).
 */
function killPort(port) {
    console.log(`[CleanPort] Checking for processes on port ${port}...`);
    try {
        // netstat -ano | findstr :3005 returns lines like:
        //  TCP    0.0.0.0:3005           0.0.0.0:0              LISTENING       1234
        const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
        
        if (!output) {
            console.log(`[CleanPort] Port ${port} is clear.`);
            return;
        }

        const lines = output.trim().split('\n');
        const pids = new Set();

        lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && !isNaN(pid)) {
                pids.add(pid);
            }
        });

        pids.forEach(pid => {
            console.log(`[CleanPort] Terminating process with PID: ${pid}`);
            try {
                execSync(`taskkill /F /PID ${pid}`);
                console.log(`[CleanPort] Process ${pid} terminated.`);
            } catch (err) {
                console.error(`[CleanPort] Failed to kill PID ${pid}: ${err.message}`);
            }
        });

    } catch (error) {
        // If findstr doesn't find anything, it returns a non-zero exit code
        if (error.status === 1) {
            console.log(`[CleanPort] Port ${port} is already clear.`);
        } else {
            console.error(`[CleanPort] Error: ${error.message}`);
        }
    }
}

// Execute for port 3005
killPort(3005);
