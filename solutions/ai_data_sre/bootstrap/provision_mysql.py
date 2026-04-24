# Copyright 2024 Collate
# Licensed under the Apache License, Version 2.0
"""Provision real MySQL tables with data — including a hidden fault.

Creates the supply_chain_analytics database in the openmetadata_mysql
container and populates 8 tables with realistic data.

The hidden fault: ~12% of raw_orders rows have order_date in the future
(up to 2027-11-15).  This propagates through the pipeline:
  raw_orders → staging_orders (negative total_price) → fact_order_metrics
  → exec_dashboard_kpis (inflated daily_revenue).

Usage:
    cd solutions/ai_data_sre
    python -m bootstrap.provision_mysql
"""

from __future__ import annotations

import random
import sys
from datetime import date, timedelta
from pathlib import Path

import pymysql
from rich.console import Console
from rich.table import Table as RichTable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.config import DataPulseConfig

console = Console()

# ─── Seed for reproducibility ──────────────────────────────────────────────────

random.seed(42)

# ─── Constants ─────────────────────────────────────────────────────────────────

CATEGORIES = ["Electronics", "Clothing", "Food", "Automotive", "Industrial"]
STATUSES = ["completed", "pending", "shipped", "cancelled", "returned"]
COUNTRIES = ["US", "CN", "DE", "JP", "KR", "IN", "MX", "BR"]
PRODUCT_NAMES = [
    "Widget Alpha", "Gizmo Beta", "Sprocket Gamma", "Bolt Delta",
    "Sensor Epsilon", "Cable Zeta", "Motor Eta", "Valve Theta",
    "Pump Iota", "Filter Kappa", "Bearing Lambda", "Gasket Mu",
    "Relay Nu", "Fuse Xi", "Switch Omicron", "Diode Pi",
    "Capacitor Rho", "Resistor Sigma", "Transistor Tau", "Inductor Upsilon",
]
SUPPLIER_NAMES = [
    "Acme Corp", "GlobalParts Ltd", "SinoTech Manufacturing",
    "Rhine Industrial GmbH", "Tokyo Precision Co",
    "Seoul Components", "Mumbai Materials", "Monterrey Metals",
]

NUM_ORDERS = 7000
NUM_FUTURE_ORDERS = 847  # ~12% — the hidden fault
TODAY = date(2026, 4, 23)


def _connect_as_user(config: DataPulseConfig) -> pymysql.Connection:
    """Connect as openmetadata_user to the supply_chain_analytics database."""
    return pymysql.connect(
        host=config.mysql.host,
        port=config.mysql.port,
        user=config.mysql.user,
        password=config.mysql.password,
        database=config.mysql.database,
        charset="utf8mb4",
        autocommit=True,
    )


def _create_database(config: DataPulseConfig) -> None:
    """Create the database and grant privileges.

    Tries docker exec first (root inside container), then falls back
    to assuming the database already exists.
    """
    console.print("\n[bold]1/9[/] Creating database…")
    import subprocess

    db = config.mysql.database
    user = config.mysql.user

    result = subprocess.run(
        [
            "docker", "exec", "openmetadata_mysql",
            "mysql", "-uroot", f"-ppassword",
            "-e", (
                f"CREATE DATABASE IF NOT EXISTS `{db}`; "
                f"GRANT ALL PRIVILEGES ON `{db}`.* TO '{user}'@'%'; "
                f"FLUSH PRIVILEGES;"
            ),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        console.print(f"  ✓ Database [green]{db}[/] ready, privileges granted to [green]{user}[/]")
    else:
        console.print(f"  [yellow]⚠ docker exec failed ({result.stderr.strip()})[/]")
        console.print(f"  [yellow]Assuming database {db} already exists…[/]")


def _create_tables(cur: pymysql.cursors.Cursor) -> None:
    """Create all 8 tables."""
    console.print("[bold]2/9[/] Creating tables…")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS raw_suppliers (
            supplier_id   INT PRIMARY KEY,
            supplier_name VARCHAR(200) NOT NULL,
            country       VARCHAR(100) NOT NULL,
            lead_time_days INT NOT NULL,
            reliability_score DECIMAL(3,2) NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS raw_products (
            product_id   INT PRIMARY KEY,
            product_name VARCHAR(200) NOT NULL,
            category     VARCHAR(100) NOT NULL,
            supplier_id  INT NOT NULL,
            cost_price   DECIMAL(10,2) NOT NULL,
            sku          VARCHAR(50) NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS raw_orders (
            order_id    INT PRIMARY KEY,
            customer_id INT NOT NULL,
            product_id  INT NOT NULL,
            order_date  DATE NOT NULL,
            quantity    INT NOT NULL,
            unit_price  DECIMAL(10,2) NOT NULL,
            status      VARCHAR(50) NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS staging_orders (
            order_id     INT PRIMARY KEY,
            customer_id  INT NOT NULL,
            product_name VARCHAR(200) NOT NULL,
            category     VARCHAR(100) NOT NULL,
            order_date   DATE NOT NULL,
            quantity     INT NOT NULL,
            total_price  DECIMAL(12,2) NOT NULL,
            status       VARCHAR(50) NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS staging_suppliers (
            supplier_id       INT PRIMARY KEY,
            supplier_name     VARCHAR(200) NOT NULL,
            country           VARCHAR(100) NOT NULL,
            lead_time_days    INT NOT NULL,
            reliability_score DECIMAL(3,2) NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS fact_order_metrics (
            metric_date     DATE PRIMARY KEY,
            total_orders    INT NOT NULL,
            total_revenue   DECIMAL(14,2) NOT NULL,
            avg_order_value DECIMAL(10,2) NOT NULL,
            top_category    VARCHAR(100) NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS fact_supply_chain (
            supplier_id            INT PRIMARY KEY,
            supplier_name          VARCHAR(200) NOT NULL,
            avg_lead_time          DECIMAL(5,1) NOT NULL,
            reliability_grade      VARCHAR(1) NOT NULL,
            total_products_supplied INT NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS exec_dashboard_kpis (
            kpi_date         DATE PRIMARY KEY,
            daily_revenue    DECIMAL(14,2) NOT NULL,
            order_volume     INT NOT NULL,
            supply_risk_score DECIMAL(5,2) NOT NULL,
            top_supplier     VARCHAR(200) NOT NULL
        )
    """)

    console.print("  ✓ 8 tables created")


def _insert_suppliers(cur: pymysql.cursors.Cursor) -> None:
    """Insert supplier data."""
    console.print("[bold]3/9[/] Inserting suppliers…")
    rows = []
    for i, name in enumerate(SUPPLIER_NAMES, start=1):
        country = COUNTRIES[i % len(COUNTRIES)]
        lead_time = random.randint(3, 45)
        reliability = round(random.uniform(0.55, 0.99), 2)
        rows.append((i, name, country, lead_time, reliability))

    cur.executemany(
        "INSERT IGNORE INTO raw_suppliers VALUES (%s, %s, %s, %s, %s)",
        rows,
    )
    console.print(f"  ✓ {len(rows)} suppliers")


def _insert_products(cur: pymysql.cursors.Cursor) -> None:
    """Insert product data."""
    console.print("[bold]4/9[/] Inserting products…")
    rows = []
    for i, name in enumerate(PRODUCT_NAMES, start=1):
        category = CATEGORIES[i % len(CATEGORIES)]
        supplier_id = (i % len(SUPPLIER_NAMES)) + 1
        cost_price = round(random.uniform(5.0, 500.0), 2)
        sku = f"SKU-{i:04d}"
        rows.append((i, name, category, supplier_id, cost_price, sku))

    cur.executemany(
        "INSERT IGNORE INTO raw_products VALUES (%s, %s, %s, %s, %s, %s)",
        rows,
    )
    console.print(f"  ✓ {len(rows)} products")


def _insert_orders(cur: pymysql.cursors.Cursor) -> list[tuple]:
    """Insert order data — including future-dated rows (the hidden fault).

    Returns the full list of order tuples for downstream staging.
    """
    console.print("[bold]5/9[/] Inserting orders (with hidden fault)…")
    orders = []

    # Normal orders: dates between 2023-01-01 and today
    normal_start = date(2023, 1, 1)
    normal_range = (TODAY - normal_start).days
    for i in range(1, NUM_ORDERS - NUM_FUTURE_ORDERS + 1):
        order_date = normal_start + timedelta(days=random.randint(0, normal_range))
        product_id = random.randint(1, len(PRODUCT_NAMES))
        quantity = random.randint(1, 100)
        unit_price = round(random.uniform(10.0, 500.0), 2)
        status = random.choice(STATUSES)
        orders.append((i, random.randint(1000, 9999), product_id, order_date, quantity, unit_price, status))

    # HIDDEN FAULT: future-dated orders
    future_start = TODAY + timedelta(days=1)
    future_end = date(2027, 11, 15)
    future_range = (future_end - future_start).days
    for i in range(NUM_ORDERS - NUM_FUTURE_ORDERS + 1, NUM_ORDERS + 1):
        order_date = future_start + timedelta(days=random.randint(0, future_range))
        product_id = random.randint(1, len(PRODUCT_NAMES))
        quantity = random.randint(1, 100)
        unit_price = round(random.uniform(10.0, 500.0), 2)
        status = random.choice(STATUSES)
        orders.append((i, random.randint(1000, 9999), product_id, order_date, quantity, unit_price, status))

    cur.executemany(
        "INSERT IGNORE INTO raw_orders VALUES (%s, %s, %s, %s, %s, %s, %s)",
        orders,
    )
    future_count = sum(1 for o in orders if o[3] > TODAY)
    console.print(
        f"  ✓ {len(orders)} orders "
        f"([red]{future_count} have future dates — HIDDEN FAULT[/])"
    )
    return orders


def _populate_staging_orders(cur: pymysql.cursors.Cursor) -> None:
    """Populate staging_orders by joining raw_orders + raw_products.

    Future-dated orders get negative total_price (simulating a
    pricing-logic bug triggered by dates beyond the current period).
    """
    console.print("[bold]6/9[/] Populating staging_orders…")
    cur.execute("""
        INSERT IGNORE INTO staging_orders
        SELECT
            o.order_id,
            o.customer_id,
            p.product_name,
            p.category,
            o.order_date,
            o.quantity,
            CASE
                WHEN o.order_date > CURDATE()
                THEN -(o.quantity * o.unit_price)
                ELSE (o.quantity * o.unit_price)
            END AS total_price,
            o.status
        FROM raw_orders o
        JOIN raw_products p ON o.product_id = p.product_id
    """)
    cur.execute("SELECT COUNT(*) FROM staging_orders WHERE total_price < 0")
    neg_count = cur.fetchone()[0]
    console.print(f"  ✓ staging_orders populated ([red]{neg_count} rows with negative total_price[/])")


def _populate_staging_suppliers(cur: pymysql.cursors.Cursor) -> None:
    """Copy suppliers to staging (simple pass-through)."""
    console.print("[bold]7/9[/] Populating staging_suppliers…")
    cur.execute("""
        INSERT IGNORE INTO staging_suppliers
        SELECT supplier_id, supplier_name, country, lead_time_days, reliability_score
        FROM raw_suppliers
    """)
    console.print("  ✓ staging_suppliers populated")


def _populate_fact_tables(cur: pymysql.cursors.Cursor) -> None:
    """Aggregate into fact tables — the fault propagates here."""
    console.print("[bold]8/9[/] Populating fact tables…")

    # fact_order_metrics: daily aggregation — future dates cause inflated revenue
    cur.execute("""
        INSERT IGNORE INTO fact_order_metrics
        SELECT
            order_date AS metric_date,
            COUNT(*) AS total_orders,
            SUM(total_price) AS total_revenue,
            AVG(total_price) AS avg_order_value,
            (SELECT category FROM staging_orders s2
             WHERE s2.order_date = s1.order_date
             GROUP BY category ORDER BY SUM(total_price) DESC LIMIT 1
            ) AS top_category
        FROM staging_orders s1
        GROUP BY order_date
    """)

    # fact_supply_chain
    cur.execute("""
        INSERT IGNORE INTO fact_supply_chain
        SELECT
            s.supplier_id,
            s.supplier_name,
            s.lead_time_days AS avg_lead_time,
            CASE
                WHEN s.reliability_score >= 0.9 THEN 'A'
                WHEN s.reliability_score >= 0.8 THEN 'B'
                WHEN s.reliability_score >= 0.7 THEN 'C'
                WHEN s.reliability_score >= 0.6 THEN 'D'
                ELSE 'F'
            END AS reliability_grade,
            (SELECT COUNT(*) FROM raw_products p WHERE p.supplier_id = s.supplier_id) AS total_products_supplied
        FROM staging_suppliers s
    """)

    # exec_dashboard_kpis: the fault fully propagates here
    cur.execute("""
        INSERT IGNORE INTO exec_dashboard_kpis
        SELECT
            f.metric_date AS kpi_date,
            f.total_revenue AS daily_revenue,
            f.total_orders AS order_volume,
            COALESCE(
                (SELECT AVG(CASE WHEN reliability_grade = 'F' THEN 1.0 ELSE 0.0 END)
                 FROM fact_supply_chain), 0
            ) AS supply_risk_score,
            COALESCE(
                (SELECT supplier_name FROM fact_supply_chain
                 ORDER BY reliability_grade ASC, avg_lead_time ASC LIMIT 1),
                'N/A'
            ) AS top_supplier
        FROM fact_order_metrics f
    """)

    # Count the damage
    cur.execute("SELECT COUNT(*) FROM exec_dashboard_kpis WHERE daily_revenue < 0 OR daily_revenue > 10000000")
    bad_kpis = cur.fetchone()[0]
    console.print(f"  ✓ fact tables populated ([red]{bad_kpis} KPI rows with anomalous revenue[/])")


def _print_summary(cur: pymysql.cursors.Cursor) -> None:
    """Print a summary of the provisioned database."""
    console.print("")
    table = RichTable(title="DataPulse Chaos Playground — MySQL Data Summary")
    table.add_column("Table", style="cyan")
    table.add_column("Rows", justify="right", style="green")
    table.add_column("Notes", style="yellow")

    for tbl, note in [
        ("raw_suppliers", ""),
        ("raw_products", ""),
        ("raw_orders", f"{NUM_FUTURE_ORDERS} future-dated (FAULT)"),
        ("staging_orders", "negative total_price propagated"),
        ("staging_suppliers", ""),
        ("fact_order_metrics", "inflated revenue on future dates"),
        ("fact_supply_chain", ""),
        ("exec_dashboard_kpis", "anomalous daily_revenue"),
    ]:
        cur.execute(f"SELECT COUNT(*) FROM `{tbl}`")
        count = cur.fetchone()[0]
        table.add_row(tbl, str(count), note)

    console.print(table)


def main() -> None:
    config = DataPulseConfig.from_env()

    console.rule("[bold cyan]DataPulse — MySQL Chaos Provisioner")

    _create_database(config)
    conn = _connect_as_user(config)
    cur = conn.cursor()

    _create_tables(cur)
    _insert_suppliers(cur)
    _insert_products(cur)
    _insert_orders(cur)
    _populate_staging_orders(cur)
    _populate_staging_suppliers(cur)
    _populate_fact_tables(cur)

    console.print("\n[bold]9/9[/] Verifying…")
    _print_summary(cur)

    cur.close()
    conn.close()

    console.rule("[bold green]MySQL provisioning complete!")
    console.print(
        "\n[bold]Next step:[/] Run [cyan]python -m bootstrap.provision_metadata[/] "
        "to register this database in OpenMetadata and trigger ingestion.\n"
    )


if __name__ == "__main__":
    main()
