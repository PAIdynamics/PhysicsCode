---
description: Evidence-backed scientific coding workflow.
agent: science
---

Use the PhysicsCode Science workflow for the following task:

$ARGUMENTS

Workflow:

1. Inspect the current project without modifying files. Use
   `science_project_context` when available.
2. Interpret the scientific and engineering request.
3. Build several complementary retrieval queries.
4. Retrieve source-backed evidence with the `science` MCP tools or local
   `science-search` / `science-source` tools when the science index is available.
5. Rerank and filter by relevance, compatibility, and license.
6. Present an evidence-backed plan before editing.
7. Modify code only when authorized.
8. Validate with build, tests, and scientific checks where applicable.
9. Report changed files, validation, limitations, sources, license notes, and
   scientific assumptions.
