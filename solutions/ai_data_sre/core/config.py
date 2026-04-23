# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""DataPulse configuration — loads from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class DataPulseConfig:
    """Immutable configuration for the DataPulse system."""

    openmetadata_host: str
    openmetadata_token: str
    ai_sdk_host: str
    ai_sdk_token: str
    openai_api_key: str
    poll_interval_seconds: int = 30
    severity_threshold: int = 2

    @classmethod
    def from_env(cls, env_file: Path | None = None) -> DataPulseConfig:
        """Load configuration from environment variables.

        Loads .env file if present, then reads required variables.
        Raises ValueError with a clear message for any missing config.
        """
        if env_file is not None and env_file.exists():
            load_dotenv(env_file)
        else:
            load_dotenv()

        missing = []
        om_host = os.environ.get("OPENMETADATA_HOST", "")
        om_token = os.environ.get("OPENMETADATA_TOKEN", "")
        ai_host = os.environ.get("AI_SDK_HOST", om_host)
        ai_token = os.environ.get("AI_SDK_TOKEN", om_token)
        openai_key = os.environ.get("OPENAI_API_KEY", "")

        if not om_host:
            missing.append("OPENMETADATA_HOST")
        if not om_token:
            missing.append("OPENMETADATA_TOKEN")
        if not openai_key:
            missing.append("OPENAI_API_KEY")

        if missing:
            raise ValueError(
                f"Missing required environment variables: {', '.join(missing)}. "
                f"Copy .env.example to .env and fill in the values."
            )

        return cls(
            openmetadata_host=om_host.rstrip("/"),
            openmetadata_token=om_token,
            ai_sdk_host=ai_host.rstrip("/"),
            ai_sdk_token=ai_token,
            openai_api_key=openai_key,
            poll_interval_seconds=int(
                os.environ.get("DATAPULSE_POLL_INTERVAL_SECONDS", "30")
            ),
            severity_threshold=int(
                os.environ.get("DATAPULSE_SEVERITY_THRESHOLD", "2")
            ),
        )

    @property
    def api_headers(self) -> dict[str, str]:
        """HTTP headers for OpenMetadata REST API calls."""
        return {
            "Authorization": f"Bearer {self.openmetadata_token}",
            "Content-Type": "application/json",
        }
