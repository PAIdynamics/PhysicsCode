# PhysicsCode VS Code Extension

PhysicsCode brings the PAI Dynamics agentic coding workflow into VS Code. It launches the PhysicsCode CLI in an integrated terminal and passes editor context, selections, and file references into your coding session.

## Prerequisites

This extension requires the PhysicsCode CLI to be installed on your system as `physicscode`. Visit [paidynamics.ch](https://paidynamics.ch) for product and installation information.

## Hosted Model Access

PhysicsCode is configured for PAI Dynamics hosted models by default. On launch, the extension checks the local CLI account state when supported by the installed CLI. If you are not logged in, it offers to start the PhysicsCode account login flow. You can also use these command palette actions:

- `PhysicsCode: Log in`
- `PhysicsCode: Log out`
- `PhysicsCode: Switch Account`
- `PhysicsCode: Open Account Dashboard`

The extension launches the CLI with:

- provider: `paidynamics`
- model: `paidynamics/gpt-oss-120b-pai`
- base URL: `https://www.paidynamics.ch/llm/v1`
- OpenAI-compatible endpoint: `POST https://www.paidynamics.ch/llm/v1/chat/completions`
- request auth: `Authorization: Bearer <PhysicsCode account access token>`
- request model: `paidynamics/gpt-oss-120b-pai`

For a self-hosted OpenAI-compatible endpoint, set `physicscode.paiBaseUrl` to your
server's `/v1` URL. If your server exposes a different model name, also set
`physicscode.paiApiModelId` to the model id accepted by the server.

## Support

This is an early release. For support and product information, visit [paidynamics.ch](https://paidynamics.ch).
