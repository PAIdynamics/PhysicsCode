// @ts-nocheck

import { PhysicsCode } from "@physicscode-ai/core"
import { ReadTool } from "@physicscode-ai/core/tools"

const physicscode = PhysicsCode.make({})

physicscode.tool.add(ReadTool)

physicscode.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

physicscode.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

physicscode.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await physicscode.session.create({
  agent: "build",
})

physicscode.subscribe((event) => {
  console.log(event)
})

await physicscode.session.prompt({
  sessionID,
  text: "hey what is up",
})

await physicscode.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await physicscode.session.wait()

console.log(await physicscode.session.messages(sessionID))
