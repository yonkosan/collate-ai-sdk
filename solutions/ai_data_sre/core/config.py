# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""DataPulse configuration — loads from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Default JWT token — generated from the dev container's private key.
# Subject=admin, issuer=open-metadata.org, expires in 1 year.
_DEFAULT_JWT = os.environ.get("OPENMETADATA_TOKEN", "")


@dataclass(frozen=True)
class MySQLConfig:
    """Connection config for the openmetadata_mysql container."""

    host: str = "localhost"
    port: int = 3306
    user: str = "openmetadata_user"
    password: str = "openmetadata_password"
    database: str = "supply_chain_analytics"
    host_for_ingestion: str = "mysql"

    @classmethod
    def from_env(cls) -> MySQLConfig:
        return cls(
            host=os.environ.get("MYSQL_HOST", "localhost"),
            port=int(os.environ.get("MYSQL_PORT", "3306")),
            user=os.environ.get("MYSQL_USER", "openmetadata_user"),
            password=os.environ.get("MYSQL_PASSWORD", "openmetadata_password"),
            database=os.environ.get("MYSQL_DATABASE", "supply_chain_analytics"),
            host_for_ingestion=os.environ.get("MYSQL_HOST_FOR_INGESTION", "mysql"),
        )


@dataclass(frozen=True)
class DataPulseConfig:
    """Immutable configuration for the DataPulse system."""

    openmetadata_host: str
    openmetadata_token: str
    ai_sdk_host: str
    ai_sdk_token: str
    openai_api_key: str
    mysql: MySQLConfig
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

        om_host = os.environ.get("OPENMETADATA_HOST", "http://localhost:8585")
        om_token = os.environ.get("OPENMETADATA_TOKEN", _DEFAULT_JWT)
        ai_host = os.environ.get("AI_SDK_HOST", om_host)
        ai_token = os.environ.get("AI_SDK_TOKEN", om_token)
        openai_key = os.environ.get("OPENAI_API_KEY", "")

        missing: list[str] = []
        if not om_host:
            missing.append("OPENMETADATA_HOST")
        if not om_token:
            missing.append("OPENMETADATA_TOKEN")

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
            mysql=MySQLConfig.from_env(),
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
