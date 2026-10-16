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
    searchMemoryTool
} from "./tools";

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
        manageGitRepositoryTool,
        saveKnowledgeTool,
        getAllKnowledgeTool,
        getMemoryStatsTool,
        ingestToLongTermMemoryTool,
        searchMemoryTool
    ];

    private static cachedTools: any[] | null = null;

    /**
     * returns an array of all registered tools.
     */
    static getTools() {
        if (!this.cachedTools) {
            this.cachedTools = [...this.tools];
        }
        return this.cachedTools;
    }

    /**
     * Dynamically register a new tool at runtime.
     */
    static registerTool(tool: any) {
        if (!this.getToolByName(tool.name)) {
            this.tools.push(tool);
            this.cachedTools = null;
            return true;
        }
        return false;
    }

    /**
     * Unregisters a tool by name (used for cleanup or runtime dynamic unloading).
     */
    static unregisterTool(name: string): boolean {
        const idx = this.tools.findIndex(t => t.name === name);
        if (idx !== -1) {
            this.tools.splice(idx, 1);
            this.cachedTools = null;
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
