import * as fs from "fs";
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, TableOfContents, StyleLevel, LevelFormat, Alignment, SpaceType } from "docx";

// --- PROJECT DATA ---
const projectTitle = "OpenClaw Echo — Autonomous AI Agent Framework";
const department = "Department of Computer Science & Engineering";
const college = "Ghousia College of Engineering, Ramanagar";
const university = "Visvesvaraya Technological University, Belagavi";
const academicYear = "2025-26";
const students = [
    { name: "Roqaiah Anjum E", usn: "1GC23CS123" },
    { name: "Mokshitha N", usn: "1GC23CS089" },
    { name: "Ambika", usn: "1GC23CS403" }
];
const guide = "Syeda Misba";
const guideDesignation = "Asst. Professor, Department of CSE";

// --- DOCUMENT HELPER ---
const createHeading = (text: string, level: any = HeadingLevel.HEADING_1) => {
    return new Paragraph({
        text,
        heading: level,
        spacing: { before: 400, after: 200 },
    });
};

const createText = (text: string, bold: boolean = false) => {
    return new Paragraph({
        children: [
            new TextRun({
                text,
                bold,
                size: 24, // 12pt
                font: "Times New Roman",
            }),
        ],
        spacing: { line: 360 }, // 1.5 spacing
        alignment: AlignmentType.JUSTIFIED,
    });
};

const createBullet = (text: string) => {
    return new Paragraph({
        children: [
            new TextRun({
                text,
                size: 24,
                font: "Times New Roman",
            }),
        ],
        bullet: {
            level: 0,
        },
        spacing: { line: 360 },
        alignment: AlignmentType.JUSTIFIED,
    });
};

// --- CONTENT GENERATION ---
const doc = new Document({
    styles: {
        paragraphStyles: [
            {
                id: "Normal",
                name: "Normal",
                run: {
                    size: 24,
                    font: "Times New Roman",
                },
                paragraph: {
                    spacing: { line: 360 },
                },
            },
        ],
    },
    sections: [
        {
            properties: {},
            children: [
                // TITLE PAGE
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text: university.toUpperCase(), bold: true, size: 28, font: "Times New Roman" }),
                    ],
                    spacing: { after: 200 },
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text: "SYNOPSIS ON", bold: true, size: 24, font: "Times New Roman" }),
                    ],
                    spacing: { after: 400 },
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text: projectTitle.toUpperCase(), bold: true, size: 36, font: "Times New Roman" }),
                    ],
                    spacing: { after: 600 },
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text: "Submitted in partial fulfillment of the requirements for the award of degree of", size: 24, font: "Times New Roman" }),
                    ],
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text: "Bachelor of Engineering", bold: true, size: 28, font: "Times New Roman" }),
                    ],
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text: "in", size: 24, font: "Times New Roman" }),
                    ],
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text: department.toUpperCase(), bold: true, size: 28, font: "Times New Roman" }),
                    ],
                    spacing: { after: 600 },
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text: "By", size: 24, font: "Times New Roman" }),
                    ],
                }),
                ...students.map(s => new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text: `${s.name} (${s.usn})`, bold: true, size: 26, font: "Times New Roman" }),
                    ],
                })),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text: "Under the Guidance of", size: 24, font: "Times New Roman" }),
                    ],
                    spacing: { before: 400 },
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text: guide, bold: true, size: 28, font: "Times New Roman" }),
                    ],
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text: guideDesignation, size: 24, font: "Times New Roman" }),
                    ],
                    spacing: { after: 800 },
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text: college.toUpperCase(), bold: true, size: 30, font: "Times New Roman" }),
                    ],
                }),
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({ text: academicYear, bold: true, size: 24, font: "Times New Roman" }),
                    ],
                }),

                // 1. INTRODUCTION
                createHeading("1. INTRODUCTION"),
                createText("Artificial Intelligence has rapidly evolved from simple, rule-based systems to complex, generative models capable of human-like interaction. However, most current AI interfaces are reactive, requiring constant human prompting and oversight to complete multi-step workflows. 'OpenClaw Echo' is an autonomous AI agent framework designed to bridge this gap by creating an independent, self-orchestrating entity."),
                createText("Unlike standard chatbots, Echo maintains persistent memory, schedules its own background tasks, analyzes codebases, and automatically manages version control. The project aims to provide a production-ready layer that can operate autonomously across various platforms, primarily integrated with Telegram for seamless accessibility."),
                createText("The motivation behind this project is to reduce the cognitive load on developers and researchers by automating repetitive tasks through a 'Neural Flow' architecture. By leveraging the power of Google Gemini 2.0 and local edge models (Ollama), OpenClaw Echo ensures both high performance and cost efficiency."),

                // 2. PROBLEM STATEMENT
                createHeading("2. PROBLEM STATEMENT"),
                createText("Current AI applications often suffer from a lack of long-term persistence and the inability to take independent actions. Users are frequently forced to manually copy-paste data between tools, re-prompt the model for context, and oversee every single step of a complex task. This 'reactive bottleneck' limits the potential of AI to serve as a true digital collaborator."),
                createText("Furthermore, existing autonomous agent experiments (like AutoGPT) often lack stability, suffer from 'infinite loops,' or have prohibitively high API costs. There is a need for a robust, production-ready framework that can safely execute tools, manage memory effectively, and switch between cloud and local models based on resource availability."),

                // 3. OBJECTIVES
                createHeading("3. OBJECTIVES"),
                createText("The primary objectives of this project are:"),
                createBullet("To develop a self-orchestrating AI agent framework capable of autonomous decision-making."),
                createBullet("To implement a 6-step Neural Flow (Ingest, Synthesis, Routing, Devolve, Execution, Persistence) for systematic task processing."),
                createBullet("To integrate persistent Long-Term Memory using SQLite and Vector Embeddings for RAG (Retrieval-Augmented Generation)."),
                createBullet("To provide a suite of 18 autonomous tools for web research, coding, file management, and communication."),
                createBullet("To build a diagnostic dashboard using Express.js and Streamlit for real-time monitoring of agent health and telemetry."),

                // 4. SCOPE OF PROJECT
                createHeading("4. SCOPE OF PROJECT"),
                createText("The scope of OpenClaw Echo includes:"),
                createBullet("Platform Integration: Full integration with Telegram for command and control."),
                createBullet("Autonomous Scheduling: Background task execution using the 'Clockwork' engine."),
                createBullet("Self-Evolution: Capability to synthesize and register new skills dynamically."),
                createBullet("DevOps Automation: Autonomous management of Git repositories and file systems."),
                createBullet("Hybrid Inference: Dynamic routing between Google Gemini (Cloud) and Ollama (Local)."),
                createText("The project is primarily intended for developers, researchers, and project managers who require an automated assistant for complex, multi-stage projects."),

                // 5. LITERATURE REVIEW / EXISTING SYSTEMS
                createHeading("5. LITERATURE REVIEW"),
                createText("The field of autonomous agents has seen significant growth with the emergence of Large Language Models (LLMs). Key existing systems include:"),
                createBullet("AutoGPT & BabyAGI: These were the pioneers of autonomous task loops but often struggled with stability and cost management."),
                createBullet("LangChain & CrewAI: These frameworks provide excellent tools for building agents but require significant boilerplate for production-level persistence and telemetry."),
                createText("OpenClaw Echo improves upon these by introducing a structured 6-step flow and a 'ModelRouter' that ensures reliability by failing over to local models during cloud API outages. Unlike many existing systems, Echo is designed for long-term deployment on cloud platforms like Railway with a focus on resource optimization."),

                // 6. PROPOSED SOLUTION
                createHeading("6. PROPOSED SOLUTION"),
                createText("The proposed solution is a Node.js-based framework that acts as the 'brain' for an autonomous agent. The architecture is centered around the 'OpenClaw Engine', which coordinates the following components:"),
                createBullet("Neural Flow Engine: A deterministic loop that guides the AI from ingestion to final persistence."),
                createBullet("ModelRouter: A singleton service that handles API calls to Google Gemini and Ollama."),
                createBullet("Vector Core: A JSON-based serverless vector database for semantic search."),
                createBullet("Skill Registry: A library of 18 specialized tools including web scrapers, code runners, and email diplomats."),
                createBullet("Sentinel Middleware: A security layer that audits all actions and prevents unauthorized file access."),

                // 7. DESIGN METHODOLOGY
                createHeading("7. DESIGN METHODOLOGY"),
                createText("The development of OpenClaw Echo follows an agile methodology, focusing on modularity and security. The system architecture is divided into four main layers:"),
                createText("1. External Hubs: Interfaces like Telegram, the Vite Dashboard (telemetry), and Streamlit (admin panel)."),
                createText("2. Core Engine: The main logic containing the Flow Engine, ModelRouter, and Clockwork Scheduler."),
                createText("3. Capabilities: Specialized sub-agents (Researcher, Engineer, Architect) that handle delegated tasks."),
                createText("4. Memory Vault: The persistent storage layer combining SQLite for relational history and Vector Core for semantic memory."),
                createText("The 6-step Neural Flow is the heart of the system:"),
                createBullet("Ingest: Capture user input and system state."),
                createBullet("Synthesis: Analyze context and identify core goals."),
                createBullet("Routing: Determine the best model and tools to use."),
                createBullet("Devolve: Break down complex goals into executable sub-tasks."),
                createBullet("Execution: Run the tools and gather results."),
                createBullet("Persistence: Update the memory and provide feedback to the user."),

                // 8. EXPECTED OUTCOMES
                createHeading("8. EXPECTED OUTCOMES"),
                createText("Upon successful completion, the project will deliver:"),
                createBullet("A robust, self-healing AI agent accessible via Telegram."),
                createBullet("A system capable of completing complex research and coding tasks with 70% less human intervention."),
                createBullet("A persistent knowledge base that grows with every interaction."),
                createBullet("A real-time dashboard visualizing the agent's internal thought processes and resource consumption."),

                // 9. CONSTRAINTS AND CHALLENGES
                createHeading("9. CONSTRAINTS AND CHALLENGES"),
                createBullet("Latency: Network delays and model inference times can impact responsiveness."),
                createBullet("Context Window: Managing large project codebases within the limited token window of LLMs."),
                createBullet("Security: Ensuring that autonomous file system operations do not compromise the host system (mitigated by sandbox isolation)."),
                createBullet("API Quotas: Staying within the rate limits of cloud-based AI providers."),

                // 10. APPLICATIONS
                createHeading("10. APPLICATIONS"),
                createBullet("Automated Software Development: Code analysis, bug fixing, and documentation generation."),
                createBullet("Deep Market Research: Scraping and synthesizing data from multiple web sources."),
                createBullet("Personal Productivity: Managing calendars, scheduling reminders, and summarizing emails."),
                createBullet("Educational Support: Providing interactive tutoring and research assistance."),

                // 11. FUTURE SCOPE
                createHeading("11. FUTURE SCOPE"),
                createBullet("Multi-Modal Integration: Enabling the agent to process images, PDFs, and voice commands."),
                createBullet("Decentralized Swarms: Allowing multiple OpenClaw agents to communicate and collaborate on massive tasks."),
                createBullet("Mobile Application: Developing a dedicated mobile interface for more advanced control features."),

                // 12. REFERENCES
                createHeading("12. REFERENCES"),
                createBullet("Brown, T. B. et al. (2020). Language Models are Few-Shot Learners. arXiv preprint."),
                createBullet("LangChain Documentation. (2024). https://js.langchain.com/"),
                createBullet("Google Gemini API Documentation. (2024). https://ai.google.dev/"),
                createBullet("Chase, H. (2023). Building Autonomous Agents with LangChain."),
                createBullet("VTU Project Guidelines. (2025).")
            ],
        },
    ],
});

// --- EXPORT TO FILE ---
Packer.toBuffer(doc).then((buffer) => {
    fs.writeFileSync("OpenClaw_Echo_Synopsis.docx", buffer);
    console.log("Synopsis report generated: OpenClaw_Echo_Synopsis.docx");
});
