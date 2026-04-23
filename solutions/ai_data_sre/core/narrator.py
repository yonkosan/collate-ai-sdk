# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Narrator agent — generates human-readable incident reports.

The Narrator takes the Investigator's findings and uses an
AI agent (via the AI SDK) to produce:
  1. A concise incident summary
  2. Root cause analysis narrative
  3. Blast radius description with affected stakeholders
  4. Severity justification
  5. Actionable remediation recommendations

Implemented in Phase 4.
"""
