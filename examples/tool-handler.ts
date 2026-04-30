import { defineTool, runTool, toolResultPart } from "../src/index.js";

const lookupIssue = defineTool<{ repo: string; issue: number }, { title: string }>({
  name: "github_issue_lookup",
  description: "Look up a GitHub issue title.",
  inputSchema: {
    type: "object",
    required: ["repo", "issue"],
    properties: {
      repo: { type: "string" },
      issue: { type: "number" },
    },
  },
  handler: async ({ repo, issue }) => ({ title: `${repo}#${issue}` }),
});

const result = await runTool(lookupIssue, { repo: "burin-labs/harn-sdk-typescript", issue: 4 });
console.log(toolResultPart("call_1", result));
