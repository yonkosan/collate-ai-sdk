# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""DQ Fixer — generates and executes SQL fixes for data quality issues.

Given a test failure and its faulty rows, uses GPT-4o-mini to generate a
safe SQL fix, then optionally executes it against the MySQL container.
Also supports re-running DQ test cases via the OM API.
"""

from __future__ import annotations

import json
import logging
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

from core.config import DataPulseConfig
from core.models import Incident, TestFailure

logger = logging.getLogger("datapulse.fixer")


@dataclass
class FixSuggestion:
    """AI-generated fix for a DQ failure."""

    test_case_name: str
    description: str
    sql: str
    impact_summary: str
    risk_level: str  # low, medium, high
    rows_affected_estimate: int
    fix_type: str = "data_fix"  # "data_fix" | "guardrail"
    fix_target: str = "symptom"  # "root_cause" | "symptom"
    # Guardrail-specific fields (for OM test case creation)
    test_definition: str = ""
    entity_link: str = ""
    parameter_values: list = field(default_factory=list)


@dataclass
class GuardrailResult:
    """Result of creating a guardrail (OM test case)."""

    success: bool
    message: str
    test_case_name: str = ""
    test_case_id: str = ""
    om_link: str = ""
    created_at: str = ""


@dataclass
class FixResult:
    """Result of executing a SQL fix."""

    success: bool
    message: str
    rows_affected: int = 0
    executed_sql: str = ""
    executed_at: str = ""


@dataclass
class RerunResult:
    """Result of re-running a DQ test case."""

    test_case_name: str
    status: str  # Success, Failed, Error
    message: str
    timestamp: str = ""


class Fixer:
    """Generates and executes data fixes, re-runs DQ tests."""

    def __init__(self, config: DataPulseConfig) -> None:
        self._config = config
        self._om_client = httpx.Client(
            base_url=config.openmetadata_host,
            headers=config.api_headers,
            timeout=30.0,
        )

    def close(self) -> None:
        self._om_client.close()

    def suggest_fix(self, incident: Incident) -> list[FixSuggestion]:
        """Use LLM to generate SQL fix suggestions + guardrail suggestions."""
        data_fixes: list[FixSuggestion]
        if not self._config.openai_api_key:
            data_fixes = self._fallback_suggestions(incident)
        else:
            try:
                data_fixes = self._llm_suggestions(incident)
            except Exception as exc:
                logger.warning("LLM suggestion failed, using fallback: %s", exc)
                data_fixes = self._fallback_suggestions(incident)

        guardrails = self.suggest_guardrails(incident)
        return data_fixes + guardrails

    def execute_fix(self, sql: str) -> FixResult:
        """Execute a SQL fix against the MySQL container.

        Only allows UPDATE and DELETE statements (no DROP, TRUNCATE, etc.).
        """
        normalized = sql.strip().rstrip(";").strip()
        upper = normalized.upper()

        # Safety: only allow UPDATE / DELETE
        if not (upper.startswith("UPDATE") or upper.startswith("DELETE")):
            return FixResult(
                success=False,
                message="Only UPDATE and DELETE statements are allowed for safety.",
            )

        # Block dangerous patterns
        dangerous = ["DROP ", "TRUNCATE ", "ALTER ", "CREATE ", "GRANT ", "REVOKE "]
        for pattern in dangerous:
            if pattern in upper:
                return FixResult(
                    success=False,
                    message=f"Blocked: statement contains disallowed keyword '{pattern.strip()}'.",
                )

        try:
            result = subprocess.run(
                [
                    "docker", "exec", "openmetadata_mysql",
                    "mysql", "-u", "root", "-ppassword",
                    "--default-character-set=utf8mb4",
                    "-e", normalized + ";",
                    self._config.mysql.database,
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode != 0:
                return FixResult(
                    success=False,
                    message=f"MySQL error: {result.stderr.strip()}",
                    executed_sql=normalized,
                )

            rows = self._parse_rows_affected(result.stdout + result.stderr)
            return FixResult(
                success=True,
                message=f"Fix applied successfully. {rows} row(s) affected.",
                rows_affected=rows,
                executed_sql=normalized,
                executed_at=datetime.now(timezone.utc).isoformat(),
            )

        except subprocess.TimeoutExpired:
            return FixResult(success=False, message="Query timed out (30s limit).")
        except Exception as exc:
            return FixResult(success=False, message=f"Execution error: {exc}")

    def rerun_test(self, test_case_id: str, test_case_name: str) -> RerunResult:
        """Re-run a DQ test case by adding a new test result via the OM API.

        Queries MySQL to check the condition, then posts the result back to OM.
        """
        try:
            # Get the test case details
            resp = self._om_client.get(
                f"/api/v1/dataQuality/testCases/{test_case_id}",
                params={"fields": "testCaseResult,testDefinition"},
            )
            if resp.status_code != 200:
                return RerunResult(
                    test_case_name=test_case_name,
                    status="Error",
                    message=f"Could not fetch test case: {resp.status_code}",
                )

            tc = resp.json()
            fqn = tc.get("fullyQualifiedName", "")
            parts = fqn.rsplit(".", 2)
            table_fqn = parts[0] if len(parts) >= 2 else fqn
            table_name = table_fqn.rsplit(".", 1)[-1]
            column = parts[1] if len(parts) >= 3 else None
            test_def = tc.get("testDefinition", {}).get("name", "")
            params = {p["name"]: p["value"] for p in tc.get("parameterValues", [])}

            # Run the check against MySQL
            check_result = self._run_check_query(table_name, column, test_def, params)

            # Post result back to OM
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            result_payload = {
                "timestamp": now_ms,
                "testCaseStatus": check_result["status"],
                "result": check_result["message"],
                "testResultValue": [
                    {"name": "resultMessage", "value": check_result["message"]},
                ],
            }

            put_resp = self._om_client.put(
                f"/api/v1/dataQuality/testCases/{test_case_id}/testCaseResult",
                json=result_payload,
            )
            if put_resp.status_code not in (200, 201):
                logger.warning("Failed to post test result: %s", put_resp.text[:200])

            return RerunResult(
                test_case_name=test_case_name,
                status=check_result["status"],
                message=check_result["message"],
                timestamp=datetime.now(timezone.utc).isoformat(),
            )

        except Exception as exc:
            logger.exception("Re-run test failed")
            return RerunResult(
                test_case_name=test_case_name,
                status="Error",
                message=str(exc),
            )

    def suggest_guardrails(self, incident: Incident) -> list[FixSuggestion]:
        """Generate guardrail suggestions — OM test cases that prevent recurrence.

        Generates guardrails for both:
        1. The table where the DQ test failed (symptom)
        2. The root cause table from blast radius (prevention at source)
        """
        guardrails: list[FixSuggestion] = []

        # Collect failed table FQNs to avoid duplicating root cause guardrails
        failed_table_fqns = {f.table_fqn for f in incident.failures}

        for f in incident.failures:
            table_fqn = f.table_fqn
            table_short = table_fqn.rsplit(".", 1)[-1]
            col = f.column
            test_def = f.test_definition or ""
            msg = f.result_message.lower()

            # Guardrails on the failed table (symptom)
            suggestions = self._guardrail_for_failure(
                f, table_fqn, table_short, col, test_def, msg,
            )
            guardrails.extend(suggestions)

        # Guardrails on the ROOT CAUSE table (prevention at source)
        br = incident.blast_radius
        if br and br.root_cause_table and br.root_cause_table not in failed_table_fqns:
            root_fqn = br.root_cause_table
            root_short = root_fqn.rsplit(".", 1)[-1]
            root_col = br.root_cause_column

            if root_col:
                # Build a synthetic message from the root cause context
                root_msg = " ".join(f.result_message.lower() for f in incident.failures)
                root_test_def = ""

                root_guardrails = self._guardrail_for_failure(
                    incident.failures[0],
                    root_fqn, root_short, root_col, root_test_def, root_msg,
                    label_prefix="[Root Cause] ",
                )
                guardrails.extend(root_guardrails)

        return guardrails

    def create_guardrail(
        self,
        name: str,
        test_definition: str,
        entity_link: str,
        parameter_values: list[dict],
        description: str = "",
    ) -> GuardrailResult:
        """Create a DQ test case in OpenMetadata as a guardrail."""
        payload: dict = {
            "name": name,
            "testDefinition": test_definition,
            "entityLink": entity_link,
        }
        if parameter_values:
            payload["parameterValues"] = parameter_values
        if description:
            payload["description"] = description

        try:
            resp = self._om_client.post(
                "/api/v1/dataQuality/testCases",
                json=payload,
            )

            if resp.status_code in (200, 201):
                data = resp.json()
                tc_id = data.get("id", "")
                tc_fqn = data.get("fullyQualifiedName", "")
                table_fqn = entity_link.strip("<>").split("::")[2].split("::")[0]
                om_link = f"{self._config.openmetadata_host}/table/{table_fqn}/profiler/data-quality"
                return GuardrailResult(
                    success=True,
                    message=f"Test case '{name}' created in OpenMetadata.",
                    test_case_name=name,
                    test_case_id=tc_id,
                    om_link=om_link,
                    created_at=datetime.now(timezone.utc).isoformat(),
                )

            if resp.status_code == 409:
                return GuardrailResult(
                    success=True,
                    message=f"Test case '{name}' already exists in OpenMetadata.",
                    test_case_name=name,
                )

            error_msg = resp.text[:300]
            logger.warning("OM test case creation failed %s: %s", resp.status_code, error_msg)
            return GuardrailResult(
                success=False,
                message=f"Failed to create test case (HTTP {resp.status_code}): {error_msg}",
            )

        except Exception as exc:
            logger.exception("Guardrail creation failed")
            return GuardrailResult(success=False, message=str(exc))

    def _guardrail_for_failure(
        self,
        failure: TestFailure,
        table_fqn: str,
        table_short: str,
        col: str | None,
        test_def: str,
        msg: str,
        label_prefix: str = "",
    ) -> list[FixSuggestion]:
        """Generate guardrail suggestions for a single failure."""
        guardrails: list[FixSuggestion] = []
        base_link = f"<#E::table::{table_fqn}>"
        col_link = f"<#E::table::{table_fqn}::columns::{col}>" if col else base_link

        # Always suggest a custom SQL guardrail for the exact root cause
        if col and ("null" in msg or test_def == "columnValuesToBeNotNull"):
            guardrails.append(FixSuggestion(
                test_case_name=failure.test_case_name,
                fix_type="guardrail",
                description=f"{label_prefix}Ensure {table_short}.{col} never has NULL values",
                sql="",
                impact_summary=f"Any future NULL values in {table_short}.{col} will be flagged immediately by OM DQ monitoring",
                risk_level="low",
                rows_affected_estimate=0,
                test_definition="columnValuesToBeNotNull",
                entity_link=col_link,
                parameter_values=[],
            ))

        if col and ("between" in test_def.lower() or "range" in msg or "negative" in msg):
            min_val = "0"
            max_val = "999999999"
            if failure.faulty_rows:
                vals = []
                for row in failure.faulty_rows:
                    v = row.row_data.get(col)
                    if v is not None:
                        try:
                            vals.append(float(str(v)))
                        except (ValueError, TypeError):
                            pass
                if vals:
                    max_val = str(int(max(abs(v) for v in vals) * 2))

            guardrails.append(FixSuggestion(
                test_case_name=failure.test_case_name,
                fix_type="guardrail",
                description=f"{label_prefix}Ensure {table_short}.{col} stays within valid range [{min_val}, {max_val}]",
                sql="",
                impact_summary=f"Values outside [{min_val}, {max_val}] in {table_short}.{col} will trigger a DQ alert",
                risk_level="low",
                rows_affected_estimate=0,
                test_definition="columnValuesToBeBetween",
                entity_link=col_link,
                parameter_values=[
                    {"name": "minValue", "value": min_val},
                    {"name": "maxValue", "value": max_val},
                ],
            ))

        if col and ("future" in msg or "date" in msg):
            guardrails.append(FixSuggestion(
                test_case_name=failure.test_case_name,
                fix_type="guardrail",
                description=f"{label_prefix}Custom SQL check: no future dates in {table_short}.{col}",
                sql="",
                impact_summary=f"Rows with {col} in the future in {table_short} will be caught by this DQ test",
                risk_level="low",
                rows_affected_estimate=0,
                test_definition="tableCustomSQLQuery",
                entity_link=base_link,
                parameter_values=[
                    {"name": "sqlExpression", "value": f"SELECT COUNT(*) FROM {{table}} WHERE `{col}` > CURDATE()"},
                    {"name": "strategy", "value": "COUNT"},
                    {"name": "threshold", "value": "0"},
                ],
            ))

        if not guardrails and col:
            guardrails.append(FixSuggestion(
                test_case_name=failure.test_case_name,
                fix_type="guardrail",
                description=f"{label_prefix}Custom SQL quality check on {table_short}.{col}",
                sql="",
                impact_summary=f"Adds a custom DQ test to OpenMetadata for ongoing monitoring of {table_short}.{col}",
                risk_level="low",
                rows_affected_estimate=0,
                test_definition="tableCustomSQLQuery",
                entity_link=base_link,
                parameter_values=[
                    {"name": "sqlExpression", "value": f"SELECT COUNT(*) FROM {{table}} WHERE `{col}` IS NULL OR `{col}` < 0"},
                    {"name": "strategy", "value": "COUNT"},
                    {"name": "threshold", "value": "0"},
                ],
            ))

        return guardrails

    def _run_check_query(
        self, table: str, column: str | None, test_def: str, params: dict
    ) -> dict:
        """Run the actual DQ check SQL against MySQL and return pass/fail."""
        db = self._config.mysql.database

        if test_def == "columnValuesToBeBetween" and column:
            min_val = params.get("minValue", "")
            max_val = params.get("maxValue", "")
            query = (
                f"SELECT COUNT(*) as cnt FROM `{db}`.`{table}` "
                f"WHERE `{column}` < '{min_val}' OR `{column}` > '{max_val}'"
            )
        elif test_def == "columnValuesToBeNotNull" and column:
            query = (
                f"SELECT COUNT(*) as cnt FROM `{db}`.`{table}` "
                f"WHERE `{column}` IS NULL"
            )
        elif test_def == "columnValuesSumToBeBetween" and column:
            min_val = params.get("minValue", "0")
            max_val = params.get("maxValue", "999999999")
            query = (
                f"SELECT SUM(`{column}`) as total FROM `{db}`.`{table}`"
            )
        elif test_def == "columnValuesToBeBetween" and column:
            min_val = params.get("minValue", "0")
            max_val = params.get("maxValue", "999999999")
            query = (
                f"SELECT COUNT(*) as cnt FROM `{db}`.`{table}` "
                f"WHERE `{column}` NOT BETWEEN {min_val} AND {max_val}"
            )
        else:
            return {"status": "Failed", "message": f"Unsupported test definition: {test_def}"}

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
                timeout=15,
            )

            if result.returncode != 0:
                return {"status": "Error", "message": result.stderr.strip()[:200]}

            lines = result.stdout.strip().split("\n")
            if len(lines) < 2:
                return {"status": "Error", "message": "No result from query"}

            value = lines[1].strip()

            if test_def == "columnValuesSumToBeBetween":
                total = float(value) if value != "NULL" else 0
                min_val = float(params.get("minValue", "0"))
                max_val = float(params.get("maxValue", "999999999"))
                if min_val <= total <= max_val:
                    return {"status": "Success", "message": f"Sum is {total:.2f}, within [{min_val}, {max_val}]. All clear."}
                return {"status": "Failed", "message": f"Sum is {total:.2f}, outside expected range [{min_val}, {max_val}]."}

            failing_count = int(value)
            if failing_count == 0:
                return {"status": "Success", "message": "All rows pass the check. 0 violations found."}
            return {"status": "Failed", "message": f"Found {failing_count} row(s) violating the check."}

        except Exception as exc:
            return {"status": "Error", "message": str(exc)}

    def _llm_suggestions(self, incident: Incident) -> list[FixSuggestion]:
        """Generate fix suggestions via GPT-4o-mini."""
        import openai

        failures_desc = []
        for f in incident.failures:
            desc = {
                "test": f.test_case_name,
                "table": f.table_fqn.rsplit(".", 1)[-1],
                "column": f.column,
                "test_definition": f.test_definition,
                "error": f.result_message,
                "faulty_rows": [
                    {"data": row.row_data, "reason": row.reason}
                    for row in (f.faulty_rows or [])[:3]
                ],
            }
            failures_desc.append(desc)

        root_cause_context = ""
        br = incident.blast_radius
        if br and br.root_cause_table:
            root_table = br.root_cause_table.rsplit(".", 1)[-1]
            root_col = br.root_cause_column or ""
            failed_tables = [f.table_fqn.rsplit(".", 1)[-1] for f in incident.failures]
            if root_table not in failed_tables:
                root_cause_context = f"""
IMPORTANT: The root cause of these failures is upstream table "{root_table}" (column: "{root_col}").
The failed tests are on downstream tables that derive from "{root_table}".
Generate fixes BOTH for the downstream tables AND for the root cause table "{root_table}" to prevent recurrence.
"""

        prompt = f"""You are a data engineer. Given these DQ test failures on a MySQL database "{self._config.mysql.database}", generate safe SQL fixes.

Failures:
{json.dumps(failures_desc, indent=2)}
{root_cause_context}
For each fix, respond with a JSON array of objects:
[{{
  "test_case_name": "...",
  "description": "Human-readable description of the fix",
  "sql": "UPDATE/DELETE SQL statement to fix the bad data",
  "impact_summary": "What this fix changes and side effects",
  "risk_level": "low|medium|high",
  "rows_affected_estimate": 123
}}]

Rules:
- Only use UPDATE or DELETE statements
- Be conservative — fix the specific bad data, don't over-correct
- Include WHERE clauses that are precise
- For date issues, use the current date as the boundary
- Return ONLY the JSON array, no markdown"""

        client = openai.OpenAI(api_key=self._config.openai_api_key)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=1500,
        )

        raw = resp.choices[0].message.content.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        suggestions_raw = json.loads(raw)

        # Tag root cause vs symptom based on description prefix
        root_table = ""
        br = incident.blast_radius
        if br and br.root_cause_table:
            root_table = br.root_cause_table.rsplit(".", 1)[-1]

        results = []
        for s in suggestions_raw:
            fix = FixSuggestion(**s)
            if root_table and root_table in fix.sql:
                fix.fix_target = "root_cause"
            results.append(fix)
        return results

    def _fallback_suggestions(self, incident: Incident) -> list[FixSuggestion]:
        """Generate hardcoded fix suggestions when LLM is unavailable."""
        suggestions = []
        db = self._config.mysql.database

        # Collect tables we've already generated fixes for
        fixed_tables: set[str] = set()

        for f in incident.failures:
            table = f.table_fqn.rsplit(".", 1)[-1]
            fixed_tables.add(table)
            self._add_fallback_fix(suggestions, db, table, f.column, f.test_case_name, f.result_message)

        # Also generate fixes for root cause table if different
        br = incident.blast_radius
        if br and br.root_cause_table:
            root_table = br.root_cause_table.rsplit(".", 1)[-1]
            if root_table not in fixed_tables:
                for f in incident.failures:
                    col = f.column or br.root_cause_column
                    if col:
                        self._add_fallback_fix(
                            suggestions, db, root_table, col,
                            f.test_case_name,
                            f.result_message,
                            label_prefix="[Root Cause] ",
                            fix_target="root_cause",
                        )

        return suggestions

    def _add_fallback_fix(
        self,
        suggestions: list[FixSuggestion],
        db: str,
        table: str,
        col: str | None,
        test_case_name: str,
        result_message: str,
        label_prefix: str = "",
        fix_target: str = "symptom",
    ) -> None:
        """Add a single fallback fix suggestion."""
        col = col or "unknown"
        msg = result_message.lower()

        if "future" in msg and col != "unknown":
            sql = f"UPDATE `{db}`.`{table}` SET `{col}` = CURDATE() WHERE `{col}` > CURDATE()"
            desc = f"{label_prefix}Cap future dates in {table}.{col} to today's date"
            impact = f"Rows with {col} in the future will be set to today"
            estimate = 847
        elif "negative" in msg and col != "unknown":
            sql = f"UPDATE `{db}`.`{table}` SET `{col}` = ABS(`{col}`) WHERE `{col}` < 0"
            desc = f"{label_prefix}Convert negative values in {table}.{col} to positive"
            impact = f"Rows with negative {col} will be made positive"
            estimate = 846
        elif "null" in msg and col != "unknown":
            sql = f"DELETE FROM `{db}`.`{table}` WHERE `{col}` IS NULL"
            desc = f"{label_prefix}Remove rows with NULL {col} from {table}"
            impact = f"Rows with NULL {col} will be deleted"
            estimate = 10
        else:
            sql = f"-- TODO: Manual fix needed for {table}.{col}"
            desc = f"{label_prefix}Manual investigation needed for {test_case_name}"
            impact = "Review the failure details and apply a custom fix"
            estimate = 0

        suggestions.append(FixSuggestion(
            test_case_name=test_case_name,
            description=desc,
            sql=sql,
            impact_summary=impact,
            risk_level="medium" if "DELETE" in sql.upper() else "low",
            rows_affected_estimate=estimate,
            fix_target=fix_target,
        ))

    @staticmethod
    def _parse_rows_affected(output: str) -> int:
        """Parse MySQL output for rows affected count."""
        import re
        match = re.search(r"(\d+)\s+row", output)
        return int(match.group(1)) if match else 0
