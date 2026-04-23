# DataPulse — AI-Powered Data Incident Command Center

> *"When your data breaks, DataPulse finds out why — before your stakeholders do."*

DataPulse is an autonomous multi-agent system that detects data quality failures, traces root causes through column-level lineage, maps blast radius to downstream consumers, and generates actionable incident reports — all powered by OpenMetadata and the Collate AI SDK.

---

## The Problem

Data quality failures propagate silently through pipelines. By the time a dashboard consumer notices stale or incorrect data, the root cause is hours old and the blast radius is unknown. Data teams spend **40%+ of their time** on manual incident triage instead of building.

## The Solution

DataPulse automates the entire data incident lifecycle:

1. **Detect** — The Sentinel agent monitors OpenMetadata for DQ test failures in real-time
2. **Investigate** — The Investigator traces column-level lineage to pinpoint the root cause and map every affected downstream asset
3. **Report** — The Narrator generates severity-scored incident reports with remediation recommendations
4. **Visualize** — A Streamlit dashboard shows the full incident lifecycle with interactive lineage graphs

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
│  │  │ Incident │ │  Lineage  │ │     AI      │ │              │
│  │  │  Cards   │ │   Graph   │ │Investigation│ │              │
│  │  └──────────┘ └───────────┘ └─────────────┘ │              │
│  └──────────────────────────────────────────────┘              │
│                         │                                       │
├─────────────────────────┼───────────────────────────────────────┤
│                         ▼                                       │
│  ┌──────────────────────────────────────────────┐              │
│  │            OpenMetadata (localhost:8585)       │              │
│  │  ┌─────────┐ ┌─────────┐ ┌────────────────┐ │              │
│  │  │ DQ API  │ │ Lineage │ │   MCP Server   │ │              │
│  │  │  Tests  │ │  Graph  │ │  (AI SDK Tools)│ │              │
│  │  └─────────┘ └─────────┘ └────────────────┘ │              │
│  └──────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### Agent Pipeline

```
                    Sentinel                 Investigator              Narrator
                   ┌────────┐               ┌────────────┐           ┌─────────┐
  DQ Test ────────►│ Detect │──► Incident ─►│ Trace      │──►       │Generate │
  Failures         │ & Group│               │ Lineage    │  Enriched │ Report  │──► Dashboard
  (OM REST API)    │        │               │ (MCP Tools)│  Incident │(AI SDK) │
                   └────────┘               │ Map Blast  │           └─────────┘
                                            │ Radius     │
                                            └────────────┘
```

### OpenMetadata Integration Points

| Feature | How DataPulse Uses It |
|---|---|
| **Data Quality API** | Sentinel polls test case results to detect failures |
| **Column-Level Lineage** | Investigator traces upstream to root cause, downstream for blast radius |
| **MCP Tools** | `search_metadata`, `get_entity_lineage`, `get_entity_details`, `root_cause_analysis` |
| **AI Agents** | Narrator invokes AI SDK agents for natural-language report generation |
| **Entity Details** | Retrieve table owners, descriptions, tags for stakeholder identification |

---

## Project Structure

```
solutions/ai_data_sre/
├── README.md                          # This file
├── requirements.txt                   # Python dependencies
├── .env.example                       # Environment variable template
│
├── bootstrap/                         # Phase 1: Demo data provisioning
│   ├── __init__.py
│   └── provision_metadata.py          # Creates supply-chain pipeline with hidden faults
│
├── core/                              # Phase 2-5: Agent logic
│   ├── __init__.py
│   ├── config.py                      # Configuration management
│   ├── models.py                      # Pydantic domain models (Incident, BlastRadius, etc.)
│   ├── sentinel.py                    # Agent 1: Monitor DQ failures
│   ├── investigator.py                # Agent 2: Lineage-based RCA
│   ├── narrator.py                    # Agent 3: Report generation
│   └── orchestrator.py                # Pipeline coordinator
│
├── ui/                                # Phase 6: Streamlit dashboard
│   ├── __init__.py
│   ├── app.py                         # Main Streamlit entry point
│   ├── pages/
│   │   ├── dashboard.py               # Incident overview
│   │   ├── incident_detail.py         # Detailed view with lineage graph
│   │   └── investigate.py             # AI chat for investigation
│   └── components/
│       ├── incident_card.py           # Incident card widget
│       ├── lineage_graph.py           # Interactive lineage visualization
│       ├── severity_badge.py          # Color-coded severity indicator
│       └── metrics.py                 # KPI metrics display
│
└── tests/                             # Unit tests
    ├── __init__.py
    ├── test_models.py
    ├── test_sentinel.py
    ├── test_investigator.py
    └── test_narrator.py
```

---

## Demo Scenario: The Chaos Playground

The `bootstrap/provision_metadata.py` script creates a **5-table supply chain analytics pipeline** in OpenMetadata with a realistic hidden fault:

```
raw_orders ──┐
             ├──► staging_orders ──► fact_order_metrics ──┐
raw_products ┘                                            ├──► exec_dashboard_kpis
                                                          │
raw_suppliers ──► staging_suppliers ──► fact_supply_chain ─┘
```

### The Hidden Fault

`raw_orders.order_date` contains **847 rows with future dates** (up to 2027-11-15). This is a realistic data ingestion bug — perhaps a source system timezone issue or a batch job loading test data into production.

**The cascade**:
1. `raw_orders.order_date` — DQ test `columnValuesToBeBetween` **FAILS**
2. `staging_orders.total_price` — Pricing logic produces negative values for future-dated orders → **FAILS**
3. `exec_dashboard_kpis.daily_revenue` — Aggregated revenue is wildly inflated → **FAILS**

The Sentinel detects the failures. The Investigator traces lineage upstream and discovers that `raw_orders.order_date` is the **root cause** — and that the blast radius extends all the way to the **executive dashboard**.

---

## Quick Start

```bash
# 1. Clone and navigate
cd collate-ai-sdk/solutions/ai_data_sre

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure
cp .env.example .env
# Edit .env with your OpenMetadata host, token, and OpenAI key

# 4. Provision the chaos playground
python -m bootstrap.provision_metadata

# 5. Run the dashboard (after agents are implemented)
streamlit run ui/app.py
```

---

## Implementation Phases

| Phase | Component | Description | Status |
|-------|-----------|-------------|--------|
| 0 | Scaffold | File structure, config, models | ✅ Done |
| 1 | Chaos Playground | Provision supply-chain pipeline with faults | ✅ Done |
| 2 | Sentinel | DQ failure detection agent | 🔲 Next |
| 3 | Investigator | Lineage-based root cause analysis | 🔲 |
| 4 | Narrator | AI-powered report generation | 🔲 |
| 5 | Orchestrator | Agent pipeline coordination | 🔲 |
| 6 | Dashboard | Streamlit UI with lineage visualization | 🔲 |
| 7 | Polish | README, demo script, presentation | 🔲 |

---

## Tech Stack

- **[Collate AI SDK](../../python/)** — MCP tools + AI agent invocation
- **[OpenMetadata](https://open-metadata.org/)** — Metadata platform (DQ, lineage, entity catalog)
- **[Streamlit](https://streamlit.io/)** — Dashboard UI
- **[LangChain](https://langchain.com/)** — Agent orchestration framework
- **[Plotly](https://plotly.com/)** — Interactive lineage visualization
- **[Pydantic](https://docs.pydantic.dev/)** — Domain model validation
- **[Rich](https://rich.readthedocs.io/)** — Terminal output formatting

---

## License

Apache License 2.0 — see [LICENSE](../../LICENSE).
