import { webSearchTool, localFileSystemTool, writeSandboxFileTool, currentTimeTool, updateUserProfileTool, runSandboxCodeTool, synthesizeSkillTool, visualizeArchitectureTool, ingestKnowledgeTool, generateDataChartTool, runSystemAuditTool, generateProjectManualTool, manageProjectGoalsTool, scrapeWebsiteTool, delegateTaskTool, sendEmailReportTool, manageScheduledTasksTool, manageGitRepositoryTool } from "./tools";

/**
 * SkillRegistry
 * A centralized hub for all autonomous tools available to the Agent.
 */
export class SkillRegistry {
    private static tools = [
        webSearchTool,
        localFileSystemTool,
        writeSandboxFileTool,
        currentTimeTool,
        updateUserProfileTool,
        runSandboxCodeTool,
        synthesizeSkillTool,
        visualizeArchitectureTool,
        ingestKnowledgeTool,
        generateDataChartTool,
        runSystemAuditTool,
        generateProjectManualTool,
        manageProjectGoalsTool,
        scrapeWebsiteTool,
        delegateTaskTool,
        sendEmailReportTool,
        manageScheduledTasksTool,
        manageGitRepositoryTool
    ];

    /**
     * returns an array of all registered tools.
     */
    static getTools() {
        return [...this.tools];
    }

    /**
     * Dynamically register a new tool at runtime.
     */
    static registerTool(tool: any) {
        if (!this.getToolByName(tool.name)) {
            this.tools.push(tool);
            return true;
        }
        return false;
    }

    /**
     * Optional: Method to get a specific tool by name.
     */
    static getToolByName(name: string) {
        const tools = this.getTools();
        return tools.find(tool => tool.name === name);
    }
}
