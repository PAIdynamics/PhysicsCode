# Agentic Validation

Phase 7 adds a deterministic harness for scientific coding tasks. The harness
does not generate patches by itself; it records the evidence, validation loops,
and failure state that an implementation agent must use.

Each task records:

- a plan before editing
- retrieval evidence and result explanations
- expected code changes and whether they require evidence
- a source and license report for selected evidence
- compilation results
- test results
- scientific validation results
- a no-retrieval baseline run

Scientific validation is intentionally separate from compilation and tests. A
task can pass syntax checks and unit tests while still failing conservation,
convergence, dimensional, benchmark, or regression validation.

Run the Phase 7 smoke task:

```sh
python -m physicscode_science.cli.main agentic-evaluate \
  --db .science/physicscode-science.sqlite \
  --tasks benchmarks/agentic/phase7-smoke.json \
  --output .science/agentic-reports
```

The command writes one report per task and mode, plus
`.science/agentic-reports/agentic-benchmark.json`.

Task files use this shape:

```json
{
  "tasks": [
    {
      "task_id": "stable-timestep-cfl",
      "prompt": "Implement or verify a stable timestep helper.",
      "workdir": "benchmarks/agentic/workspaces/stable_timestep",
      "retrieval": { "query": "stable timestep CFL condition", "top_k": 5 },
      "expected_changes": [
        { "path": "candidate.py", "description": "Provide the helper." }
      ],
      "compilation": [
        { "name": "compile candidate", "command": ["python3", "-m", "py_compile", "candidate.py"] }
      ],
      "tests": [
        { "name": "unit tests", "command": ["python3", "test_candidate.py"] }
      ],
      "scientific_validation": [
        {
          "name": "CFL bound",
          "command": ["python3", "validate_science.py"],
          "template": "conservation",
          "criterion": "dt <= dx / wave_speed"
        }
      ]
    }
  ]
}
```

Failures are report data, not exceptions to hide. Non-zero command exits,
timeouts, and missing required evidence are preserved in the `failures` array.

