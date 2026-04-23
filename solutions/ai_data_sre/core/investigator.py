# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Investigator agent — traces lineage to find root causes and map blast radius.

The Investigator takes incidents from the Sentinel and uses
the AI SDK's MCP tools (get_entity_lineage, search_metadata,
root_cause_analysis) to:
  1. Walk upstream lineage to find the root cause table/column
  2. Walk downstream lineage to map the full blast radius
  3. Identify affected owners and stakeholders

Implemented in Phase 3.
"""
