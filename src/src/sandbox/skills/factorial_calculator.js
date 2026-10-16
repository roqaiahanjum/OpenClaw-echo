
const { tool } = require("@langchain/core/tools");
const { z } = require("zod");

exports.tool = tool(
    async (input) => {
        function factorial(n) { if (n === 0) return 1; else return n * factorial(n - 1); }
    },
    {
        name: "factorial_calculator",
        description: "Calculates factorial numbers",
        schema: z.object({ n: z.number() })
    }
);
