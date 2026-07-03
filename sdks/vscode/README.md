# PhysicsCode VS Code Extension

PhysicsCode brings the PAI Dynamics agentic coding workflow into VS Code. It launches the PhysicsCode CLI in an integrated terminal and passes editor context, selections, and file references into your coding session.

## Prerequisites

This extension requires the PhysicsCode CLI to be installed on your system as `physicscode`. Visit [paidynamics.ch](https://paidynamics.ch) for product and installation information.

## Hosted Model Access

PhysicsCode is configured for PAI Dynamics hosted models by default. Run `PhysicsCode: Set PAI Dynamics API Key` from the VS Code command palette, paste your user API key, then open PhysicsCode.

The extension launches the CLI with:

- provider: `paidynamics`
- model: `paidynamics/gpt-oss-120b-pai`
- base URL: `https://www.paidynamics.ch/llm/v1`

## Support

This is an early release. For support and product information, visit [paidynamics.ch](https://paidynamics.ch).
