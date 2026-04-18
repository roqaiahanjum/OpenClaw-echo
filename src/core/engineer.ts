import simpleGit, { SimpleGit, SimpleGitOptions } from "simple-git";
import * as path from "path";

/**
 * Engineer: Autonomous Version Control & Workspace Engine
 * Grants the agent safe access to git version control.
 */
export class Engineer {
    private static getGitClient(): SimpleGit {
        // Run git against the root project folder
        const rootPath = path.resolve(__dirname, "../../"); 
        const options: Partial<SimpleGitOptions> = {
            baseDir: rootPath,
            binary: 'git',
            maxConcurrentProcesses: 1,
            trimmed: true,
        };
        return simpleGit(options);
    }

    static async getStatus(): Promise<string> {
        const git = this.getGitClient();
        try {
            const isRepo = await git.checkIsRepo();
            if (!isRepo) {
                return "Error: This directory is not a git workspace.";
            }

            const status = await git.status();
            let report = `Current Branch: ${status.current}\n`;
            
            if (status.modified.length > 0) report += `Modified: \n - ${status.modified.join('\n - ')}\n`;
            if (status.not_added.length > 0) report += `Untracked: \n - ${status.not_added.join('\n - ')}\n`;
            if (status.deleted.length > 0) report += `Deleted: \n - ${status.deleted.join('\n - ')}\n`;

            if (status.isClean()) {
                report += "\nWorking tree is clean. Nothing to commit.";
            } else {
                report += "\nChanges are pending. Ready for commit.";
            }

            return report;
        } catch (error: any) {
            console.error("[Engineer] Status error:", error);
            return `Git status failed: ${error.message}`;
        }
    }

    static async commitAll(message: string): Promise<string> {
        const git = this.getGitClient();
        try {
            const status = await git.status();
            if (status.isClean()) {
                return "Push skipped. Nothing to commit.";
            }
            // Add all
            await git.add('./*');
            // Commit
            const commitResult = await git.commit(message);
            return `Successfully committed changes.\nCommit Hash: ${commitResult.commit}\nBranch: ${commitResult.branch}\nMessage: "${message}"`;
        } catch (error: any) {
            console.error("[Engineer] Commit error:", error);
            return `Git commit failed: ${error.message}`;
        }
    }

    static async pushToRemote(): Promise<string> {
        const git = this.getGitClient();
        try {
            const result = await git.push();
            return `Successfully pushed to remote repository.`;
        } catch (error: any) {
            console.error("[Engineer] Push error:", error);
            return `Git push failed: ${error.message}. Ensure remote is set up and authenticated.`;
        }
    }
}
