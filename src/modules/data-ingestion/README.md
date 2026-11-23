# Data Ingestion Module

The Data Ingestion module is the React and Ant Design interface for the Foundry
`adp/data-ingestion` service.

## Entry points

- `/data-ingestion` — overview
- `/data-ingestion/import` — upload, inspect, execute, and verify ingestion
- `/data-ingestion/pipelines` — pipeline templates and complete stage specifications
- `/data-ingestion/sources` — source configuration
- `/data-ingestion/runs` — run history and stage details
- `/data-ingestion/catalog` — datasets and canonical records
- `/data-ingestion/auto-scan` — scheduled discovery
- `/data-ingestion/agent` — built-in Agent and MCP workbench

When no control database is configured, the module shows a first-run setup
screen. A platform administrator enters the MySQL/MariaDB connection, optionally
supplies a one-time database creation connection, and initializes the schema.
The encrypted connection URL is stored in the deployment's
`data-ingestion-config` volume. Administrators can later switch to another
control database from the page header. Switching preserves the old database and
does not copy or delete its data.

All requests use the existing Studio HTTP client, OAuth token, locale, and error
handling. The callback APIs are exposed through `DataIngestionWorkbenchScene`
and the module manifest so other agents can integrate the same scene without
importing route pages.
