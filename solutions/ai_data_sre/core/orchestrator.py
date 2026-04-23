# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Orchestrator — coordinates the Sentinel → Investigator → Narrator pipeline.

The Orchestrator is the top-level coordinator that:
  1. Runs the Sentinel to detect new failures
  2. Feeds incidents to the Investigator for RCA
  3. Passes investigation results to the Narrator
  4. Manages incident deduplication and state
  5. Exposes results for the Streamlit UI

Implemented in Phase 5.
"""
