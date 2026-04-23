# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Sentinel agent — monitors OpenMetadata for data quality test failures.

The Sentinel is the first stage of the DataPulse pipeline.
It polls the OpenMetadata DQ API, detects new failures,
groups them by table, and emits Incident objects for the
Investigator to analyze.

Implemented in Phase 2.
"""
