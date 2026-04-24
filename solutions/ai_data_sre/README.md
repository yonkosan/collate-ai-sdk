# DataPulse — AI-Powered Data Incident Command Center

> *"When your data breaks, DataPulse finds out why — before your stakeholders do."*

<p align="center">
  <img src="https://img.shields.io/badge/OpenMetadata-Powered-blue?style=for-the-badge" />
  <img src="https://img.shields.io/badge/AI-GPT--4o--mini-green?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Python-3.9+-yellow?style=for-the-badge" />
  <img src="https://img.shields.io/badge/License-Apache%202.0-red?style=for-the-badge" />
</p>

DataPulse is an autonomous **multi-agent system** that detects data quality failures, traces root causes through column-level lineage, maps blast radius to downstream consumers, and generates actionable incident reports — all powered by **OpenMetadata** and the **Collate AI SDK**.

---

## The Problem

Data quality failures propagate silently through pipelines. By the time a dashboard consumer notices stale or incorrect data, the root cause is hours old and the blast radius is unknown. Data teams spend **40%+ of their time** on manual incident triage instead of building.

## The Solution

DataPulse automates the **entire data incident lifecycle** with three specialized AI agents:

| Agent | Role | How |
|-------|------|-----|
| **🔍 Sentinel** | Detect failures | Polls OpenMetadata DQ API for failed test cases, groups by table, assigns initial severity |
| **🔎 Investigator** | Trace root cause + blast radius | BFS walks upstream lineage to root cause, downstream to map all impacted assets, escalates severity |
| **📝 Narrator** | Generate incident reports | GPT-4o-mini produces structured RCA with summary, blast radius, severity justification, and recommendations |

All three agents are orchestrated in a single pipeline and visualized in a **Streamlit dashboard** with interactive lineage graphs.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     DataPulse Architecture                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌──────────┐              │
│  │ SENTINEL │───►│ INVESTIGATOR │───►│ NARRATOR │              │
│  │ (Detect) │    │ (RCA + Blast)│    │ (Report) │              │
│  └────┬─────┘    └──────┬───────┘    └────┬─────┘              │
│       │                 │                  │                    │
│       │    ┌────────────┴────────────┐     │                    │
│       │    │      ORCHESTRATOR       │     │                    │
│       │    │  (Pipeline Coordinator) │     │                    │
│       │    └────────────┬────────────┘     │                    │
│       │                 │                  │                    │
│  ┌────┴─────────────────┴──────────────────┴────┐              │
│  │              STREAMLIT DASHBOARD              │              │
│  │  ┌──────────┐ ┌───────────┐ ┌─────────────┐ │              │
│  │  │ Incident │ │  Lineage  │ │   AI Report  │ │              │
│  │  │  Cards   │ │   Graph   │ │   Viewer    │ │              │
│  │  └──────────┘ └───────────┘ └─────────────┘ │              │
│  └──────────────────────────────────────────────┘              │
│                         │                                       │
├─────────────────────────┼───────────────────────────────────────┤
│                         ▼                                       │
│  ┌──────────────────────────────────────────────┐              │
│  │            OpenMetadata (localhost:8585)       │              │
│  │  ┌─────────┐ ┌─────────┐ ┌────────────────┐ │              │
│  │  │  DQ API │ │ Lineage │ │  Entity Catalog │ │              │
│  │  │  Tests  │ │  Graph  │ │  (REST API)    │ │              │
│  │  └─────────┘ └─────────┘ └────────────────┘ │              │
│  └──────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### Agent Pipeline Detail

```
  OpenMetadata DQ API         Sentinel               Investigator              Narrator
  ┌─────────────────┐       ┌──────────┐            ┌─────────────┐          ┌──────────┐
  │ testCases?      │──────►│ Detect & │──Incident─►│ Trace       │─Enriched►│ Generate │──► Dashboard
  │ status=Failed   │       │ Group by │            │ Lineage     │ Incident │ Report   │
  │                 │       │ Table    │            │ Map Blast   │          │ (GPT-4o) │
  └─────────────────┘       │ Assess   │            │ Radius      │          └──────────┘
                            │ Severity │            │ Escalate    │
                            └──────────┘            │ Severity    │
                                                    └─────────────┘
```

### OpenMetadata Integration Points

| Feature | How DataPulse Uses It |
|---|---|
| **Data Quality API** | `GET /api/v1/dataQuality/testCases?testCaseStatus=Failed` — Sentinel polls for failures |
| **Column-Level Lineage** | `GET /api/v1/lineage/table/name/{fqn}?upstreamDepth=3&downstreamDepth=3` — Investigator traces upstream root cause + downstream impact |
| **Entity REST API** | `PUT /api/v1/tables`, `PUT /api/v1/lineage` — Bootstrap provisions entities + lineage edges |
| **Test Case Results** | `POST /api/v1/testCases/testCaseResults/{fqn}` — Bootstrap seeds pass/fail test results |

---

## Demo Scenario: The Chaos Playground

The bootstrap script creates an **8-table supply chain analytics pipeline** in OpenMetadata with a **realistic hidden fault**:

```
raw_orders ──────┐
                 ├──► staging_orders ──► fact_order_metrics ──┐
raw_products ────┘                                            ├──► exec_dashboard_kpis
                                                              │
raw_suppliers ──► staging_suppliers ──► fact_supply_chain ─────┘
```

### The Hidden Fault

`raw_orders.order_date` contains **847 rows with future dates** (up to 2027-11-15). This is a realistic data ingestion bug — a source system timezone issue or a batch job loading test data into production.

**The cascade:**
1. **`raw_orders.order_date`** — DQ test `columnValuesToBeBetween` **FAILS** (847 rows exceed max date)
2. **`staging_orders.total_price`** — Pricing logic produces **negative values** for future-dated orders → **FAILS**
3. **`exec_dashboard_kpis.daily_revenue`** — Aggregated revenue is wildly inflated → **FAILS**

The **Sentinel** detects 3 failures. The **Investigator** traces lineage upstream and discovers that `raw_orders` is the **root cause** — and that the blast radius extends all the way to the **executive dashboard** (up to 11 assets affected). The **Narrator** generates detailed reports explaining exactly what happened, why, and what to do about it.

---

## Project Structure

```
solutions/ai_data_sre/
├── README.md                          # This file
├── requirements.txt                   # Python dependencies
├── run_demo.sh                        # One-command demo launcher
├── .env.example                       # Environment variable template
│
├── bootstrap/                         # Demo data provisioning
│   ├── __init__.py
│   ├── provision_mysql.py             # Creates 8 tables with 7000+ rows + hidden fault
│   └── provision_metadata.py          # Registers entities, lineage, DQ tests in OpenMetadata
│
├── core/                              # Multi-agent pipeline
│   ├── __init__.py
│   ├── config.py                      # Configuration (loads from .env)
│   ├── models.py                      # Pydantic domain models (Incident, BlastRadius, etc.)
│   ├── sentinel.py                    # Agent 1: Monitor DQ failures
│   ├── investigator.py                # Agent 2: Lineage-based root cause analysis
│   ├── narrator.py                    # Agent 3: AI-powered report generation
│   └── orchestrator.py                # Pipeline coordinator
│
├── ui/                                # Streamlit dashboard
│   ├── __init__.py
│   ├── app.py                         # Main entry point (dark theme, 3 tabs)
│   └── components/
│       ├── __init__.py
│       ├── incident_cards.py          # Severity badges, KPI cards, expandable cards
│       └── lineage_graph.py           # Interactive lineage visualization (streamlit-agraph)
│
└── tests/                             # Unit tests
    ├── __init__.py
    ├── test_models.py                 # Domain model tests
    ├── test_sentinel.py               # Sentinel agent tests (mocked HTTP)
    ├── test_investigator.py           # Investigator agent tests (mocked lineage)
    └── test_narrator.py               # Narrator agent tests (mocked LLM)
```

---

## Quick Start

### Prerequisites

- **Python 3.9+** (tested with 3.9, 3.10, 3.11)
- **Docker** running with OpenMetadata dev container at `localhost:8585`
- **OpenAI API key** (for GPT-4o-mini report generation)

### One-Command Demo

```bash
cd collate-ai-sdk/solutions/ai_data_sre
chmod +x run_demo.sh
./run_demo.sh
```

This will:
1. Install dependencies
2. Provision MySQL tables with hidden faults
3. Register entities + lineage + DQ tests in OpenMetadata
4. Launch the Streamlit dashboard at **http://localhost:8501**

### Manual Setup

```bash
# 1. Navigate to the project
cd collate-ai-sdk/solutions/ai_data_sre

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Edit .env with your OpenMetadata token and OpenAI API key

# 4. Provision the chaos playground (requires OpenMetadata + MySQL containers)
python -m bootstrap.provision_mysql
python -m bootstrap.provision_metadata

# 5. Launch the dashboard
python -m streamlit run ui/app.py --server.port 8501

# 6. Open http://localhost:8501 and click "▶ Run Full Pipeline"
```

### Running Tests

```bash
cd collate-ai-sdk/solutions/ai_data_sre
python -m pytest tests/ -v
```

---

## Dashboard Features

### 📋 Incident Dashboard
- Incidents sorted by severity (most critical first)
- Color-coded severity badges (🔴 CRITICAL, 🟠 HIGH, 🟡 MEDIUM)
- KPI row: total incidents, critical/high count, total blast radius, tables affected
- Expandable cards with full AI-generated reports

### 🔗 Blast Radius Graph
- Interactive lineage visualization using `streamlit-agraph`
- Color-coded nodes: **red** = root cause, **orange** = affected, **indigo** = healthy
- Red edges show the corruption propagation path
- Incident selector to visualize blast radius per incident

### 📄 Full Reports
- AI-generated root cause analysis by GPT-4o-mini
- Structured sections: summary, RCA, blast radius, severity justification
- Numbered actionable recommendations
- Raw test failure details with table/column/message

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Metadata Platform** | [OpenMetadata](https://open-metadata.org/) | DQ tests, lineage graph, entity catalog |
| **AI Reports** | [OpenAI GPT-4o-mini](https://openai.com/) | Structured incident report generation |
| **Dashboard** | [Streamlit](https://streamlit.io/) | Interactive web UI |
| **Lineage Viz** | [streamlit-agraph](https://github.com/ChristianKlose/streamlit-agraph) | Graph visualization |
| **Domain Models** | [Pydantic](https://docs.pydantic.dev/) | Type-safe data validation |
| **HTTP Client** | [httpx](https://www.python-httpx.org/) | REST API calls to OpenMetadata |
| **CLI Output** | [Rich](https://rich.readthedocs.io/) | Terminal formatting and tables |
| **Database** | [MySQL](https://www.mysql.com/) + [PyMySQL](https://pymysql.readthedocs.io/) | Demo data with realistic faults |

---

## Implementation Phases

| Phase | Component | Description | Status |
|-------|-----------|-------------|--------|
| 0 | Scaffold | File structure, config, Pydantic models | ✅ Done |
| 1 | Chaos Playground | MySQL tables + OpenMetadata provisioning with hidden faults | ✅ Done |
| 2 | Sentinel | DQ failure detection agent (polls OM API, groups by table, assesses severity) | ✅ Done |
| 3 | Investigator | Lineage-based RCA (BFS upstream/downstream, blast radius mapping, severity escalation) | ✅ Done |
| 4 | Narrator | GPT-4o-mini report generation (structured JSON, fallback for no API key) | ✅ Done |
| 5 | Orchestrator | Sentinel → Investigator → Narrator pipeline coordination | ✅ Done |
| 6 | Dashboard | Streamlit UI with lineage graph, incident cards, KPI metrics | ✅ Done |
| 7 | Polish | README, demo script, unit tests | ✅ Done |

---

## How It Works (End-to-End)

1. **Bootstrap** provisions a realistic supply-chain pipeline in MySQL and OpenMetadata with hidden data quality faults (future dates in `raw_orders`)

2. **Sentinel** polls `GET /api/v1/dataQuality/testCases?testCaseStatus=Failed` and detects 3 failures across `raw_orders`, `staging_orders`, and `exec_dashboard_kpis`

3. **Investigator** fetches lineage for each failing table via `GET /api/v1/lineage/table/name/{fqn}`, walks upstream (BFS) to find `raw_orders` as root cause, walks downstream to map blast radius of 4–11 assets, and escalates severity based on impact

4. **Narrator** sends incident data to GPT-4o-mini with a structured prompt, receives JSON with summary, RCA, blast radius description, severity justification, and recommendations

5. **Dashboard** renders everything in a dark-themed Streamlit app with interactive lineage graphs and expandable incident cards

---

## License

Apache License 2.0 — see [LICENSE](../../LICENSE).
