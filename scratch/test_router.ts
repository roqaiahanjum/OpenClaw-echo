import "dotenv/config";
import { ModelRouter } from "../src/core/router";
import { HumanMessage } from "@langchain/core/messages";

async function testRouter() {
    console.log("Testing ModelRouter...");
    try {
        const router = ModelRouter.getInstance();
        const res = await router.invoke([new HumanMessage("Say hello in one word.")]);
        console.log("Response:", res.content);
    } catch (e: any) {
        console.error("Router Error:", e.message);
    }
}

testRouter();
