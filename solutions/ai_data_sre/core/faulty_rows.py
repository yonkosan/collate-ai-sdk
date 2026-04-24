# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Faulty row fetcher — queries MySQL to retrieve sample rows that failed DQ checks.

Maps test definitions to SQL WHERE clauses and fetches up to 5 example rows
so operators can see the actual bad data, not just "847 rows failed".
"""

from __future__ import annotations

import logging
import subprocess
import json
from typing import List

from core.config import DataPulseConfig
from core.models import FaultyRow, TestFailure

logger = logging.getLogger("datapulse.faulty_rows")

# Maps OpenMetadata test definition names to SQL WHERE clause generators.
# Each function takes (column_name) and returns a WHERE clause.
TEST_TO_WHERE = {
    "columnValuesToBeNotNull": lambda col: f"`{col}` IS NULL",
    "columnValuesToBeBetween": lambda col: f"`{col}` < 0",
    "columnValuesToBeNotInSet": lambda col: f"`{col}` IN ('INVALID', 'ERROR', 'N/A')",
    "tableRowCountToEqual": lambda _col: "1=1",
    "columnValuesSumToBeBetween": lambda col: f"`{col}` < 0",
}

MAX_ROWS = 5


def fetch_faulty_rows(config: DataPulseConfig, failure: TestFailure) -> List[FaultyRow]:
    """Fetch sample rows from MySQL that match the failure condition."""
    if not failure.column:
        return []

    table_name = failure.table_fqn.rsplit(".", 1)[-1]
    where_fn = TEST_TO_WHERE.get(failure.test_definition)
    if not where_fn:
        # Fallback: try to infer from result message
        where_fn = _infer_where_from_message(failure)
        if not where_fn:
            return []

    where_clause = where_fn(failure.column)
    query = (
        f"SELECT * FROM `{config.mysql.database}`.`{table_name}` "
        f"WHERE {where_clause} LIMIT {MAX_ROWS}"
    )

    try:
        result = subprocess.run(
            [
                "docker", "exec", "openmetadata_mysql",
                "mysql", "-u", "root", "-ppassword",
                "--default-character-set=utf8mb4",
                "-e", query,
                "--batch", "--raw",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            logger.warning("MySQL query failed: %s", result.stderr.strip())
            return []

        return _parse_mysql_output(result.stdout, failure.test_definition, failure.column)
    except Exception as exc:
        logger.warning("Failed to fetch faulty rows: %s", exc)
        return []


def _parse_mysql_output(output: str, test_def: str, column: str) -> List[FaultyRow]:
    """Parse tab-separated MySQL batch output into FaultyRow objects."""
    lines = output.strip().split("\n")
    if len(lines) < 2:
        return []

    headers = lines[0].split("\t")
    rows = []
    for line in lines[1:]:
        values = line.split("\t")
        row_data = {}
        for h, v in zip(headers, values):
            row_data[h] = v if v != "NULL" else None
        reason = f"{column} = {row_data.get(column, 'N/A')} (test: {test_def})"
        rows.append(FaultyRow(row_data=row_data, reason=reason))

    return rows


def _infer_where_from_message(failure: TestFailure) -> object:
    """Try to infer a WHERE clause from the failure result message."""
    msg = failure.result_message.lower()
    col = failure.column

    if "null" in msg:
        return lambda c: f"`{c}` IS NULL"
    if "negative" in msg or "< 0" in msg or "less than" in msg:
        return lambda c: f"`{c}` < 0"
    if "future" in msg or "greater than" in msg:
        return lambda c: f"`{c}` > NOW()"

    return None
