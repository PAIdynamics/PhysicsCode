from __future__ import annotations


SCIENTIFIC_VALIDATION_TEMPLATES: dict[str, dict[str, str]] = {
    "conservation": {
        "goal": "Verify a conserved quantity stays within an explicit tolerance.",
        "evidence": "Record initial value, final value, tolerance, and relative drift.",
    },
    "convergence": {
        "goal": "Verify error decreases at the expected rate under mesh or timestep refinement.",
        "evidence": "Record refinement levels, errors, observed order, and expected order.",
    },
    "dimensional": {
        "goal": "Verify units and nondimensional constants remain consistent.",
        "evidence": "Record unit assumptions, converted values, and checked expressions.",
    },
    "benchmark": {
        "goal": "Compare against a published or repository-provided benchmark value.",
        "evidence": "Record reference source, observed value, tolerance, and difference.",
    },
    "regression": {
        "goal": "Verify existing numerical behavior did not change unexpectedly.",
        "evidence": "Record baseline output, new output, tolerance, and changed fields.",
    },
}


def validation_template(name: str) -> dict[str, str]:
    return SCIENTIFIC_VALIDATION_TEMPLATES.get(name, SCIENTIFIC_VALIDATION_TEMPLATES["regression"])

