import {
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
    manageGitRepositoryTool,
    saveKnowledgeTool,
    getAllKnowledgeTool,
    getMemoryStatsTool,
    ingestToLongTermMemoryTool,
    searchMemoryTool,
    getConversationHistoryTool,
    conversationContextTool
} from "./tools";

/**
 * SkillRegistry
 * A centralized hub for all autonomous tools available to the Agent.
 */
export class SkillRegistry {
    private static tools: any[] | null = null;

    /**
     * returns an array of all registered tools.
     */
    static getTools() {
        if (!this.tools) {
            this.tools = [
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
                manageGitRepositoryTool,
                saveKnowledgeTool,
                getAllKnowledgeTool,
                getMemoryStatsTool,
                ingestToLongTermMemoryTool,
                searchMemoryTool,
                getConversationHistoryTool,
                conversationContextTool
            ].filter(Boolean);
        }
        return this.tools;
    }

    /**
     * Dynamically register a new tool at runtime.
     */
    static registerTool(tool: any) {
        const tools = this.getTools();
        if (!this.getToolByName(tool.name)) {
            tools.push(tool);
            return true;
        }
        return false;
    }

    /**
     * Unregisters a tool by name (used for cleanup or runtime dynamic unloading).
     */
    static unregisterTool(name: string): boolean {
        const tools = this.getTools();
        const idx = tools.findIndex(t => t.name === name);
        if (idx !== -1) {
            tools.splice(idx, 1);
            return true;
        }
        return false;
    }

    /**
     * Optional: Method to get a specific tool by name.
     */
    static getToolByName(name: string) {
        const tools = this.getTools();
        if (name === "send_email") {
            return tools.find((t: any) => t.name === "send_email_report");
        }
        return tools.find((t: any) => t.name === name);
    }
}
