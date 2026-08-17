import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
if (!process.env.GOOGLE_API_KEY) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

async function testAll() {
  console.log('\n=== OPENCLAW API DIAGNOSTIC ===\n');

  // TEST 1: Gemini WITHOUT tools
  console.log('TEST 1: Gemini direct call (no tools)...');
  try {
    const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
    const { HumanMessage } = await import('@langchain/core/messages');
    const model = new ChatGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '',
      model: 'gemini-2.5-flash',
    });
    const res = await model.invoke([new HumanMessage('Say hello in one word')]);
    console.log('✅ Gemini WITHOUT tools: WORKING');
    console.log('   Response:', res.content);
  } catch (e: any) {
    console.log('❌ Gemini WITHOUT tools: FAILED');
    console.log('   Error:', e.message?.slice(0, 200));
  }

  // TEST 2: Groq WITHOUT tools
  console.log('\nTEST 2: Groq direct call (no tools)...');
  try {
    const { ChatGroq } = await import('@langchain/groq');
    const { HumanMessage } = await import('@langchain/core/messages');
    const model = new ChatGroq({
      apiKey: process.env.GROQ_API_KEY || process.env.GROQ_KEY || '',
      model: 'llama-3.1-8b-instant',
    });
    const res = await model.invoke([new HumanMessage('Say hello in one word')]);
    console.log('✅ Groq WITHOUT tools: WORKING');
    console.log('   Response:', res.content);
  } catch (e: any) {
    console.log('❌ Groq WITHOUT tools: FAILED');
    console.log('   Error:', e.message?.slice(0, 200));
  }

  // TEST 3: Gemini WITH tools (the real problem)
  console.log('\nTEST 3: Gemini WITH tools (checking schema)...');
  try {
    const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
    const { HumanMessage } = await import('@langchain/core/messages');
    const { tool } = await import('@langchain/core/tools');
    const { z } = await import('zod');

    const testTool = tool(
      async ({ input }) => `You said: ${input}`,
      {
        name: 'test_tool',
        description: 'A simple test tool',
        schema: z.object({
          input: z.string().describe('The input text'),
        }),
      }
    );

    const model = new ChatGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '',
      model: 'gemini-2.5-flash',
    });

    const modelWithTools = model.bindTools([testTool]);
    const res = await modelWithTools.invoke([
      new HumanMessage('What is 2 + 2? Do not use any tools.')
    ]);
    console.log('✅ Gemini WITH tools: WORKING');
    console.log('   Response:', res.content);
  } catch (e: any) {
    console.log('❌ Gemini WITH tools: FAILED');
    console.log('   Error:', e.message?.slice(0, 300));
  }

  // TEST 4: Load ALL 22 tools and bind to Gemini
  console.log('\nTEST 4: Gemini with ALL 22 real tools...');
  try {
    const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
    const { HumanMessage } = await import('@langchain/core/messages');
    const { SkillRegistry } = await import('../src/skills/registry');

    const registry = new SkillRegistry();
    const tools = registry.getTools();
    console.log(`   Loaded ${tools.length} tools from registry`);

    const model = new ChatGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '',
      model: 'gemini-2.5-flash',
    });

    const modelWithTools = model.bindTools(tools);
    const res = await modelWithTools.invoke([
      new HumanMessage('What is the current time?')
    ]);
    console.log('✅ Gemini with ALL tools: WORKING');
    console.log('   Response type:', typeof res.content);
  } catch (e: any) {
    console.log('❌ Gemini with ALL tools: FAILED');
    console.log('   Full error:', e.message?.slice(0, 500));

    // Find WHICH tool is broken
    console.log('\n   Scanning which tool has bad schema...');
    try {
      const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
      const { SkillRegistry } = await import('../src/skills/registry');
      const registry = new SkillRegistry();
      const tools = registry.getTools();

      const model = new ChatGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '',
        model: 'gemini-2.5-flash',
      });

      for (let i = 0; i < tools.length; i++) {
        try {
          model.bindTools([tools[i]]);
          console.log(`   ✅ Tool ${i + 1}: ${tools[i].name} — schema OK`);
        } catch (toolErr: any) {
          console.log(`   ❌ Tool ${i + 1}: ${tools[i].name} — BAD SCHEMA`);
          console.log(`      Error: ${toolErr.message?.slice(0, 150)}`);
        }
      }
    } catch (scanErr: any) {
      console.log('   Could not scan tools:', scanErr.message);
    }
  }

  console.log('\n=== DIAGNOSTIC COMPLETE ===\n');
}

testAll().catch(console.error);
