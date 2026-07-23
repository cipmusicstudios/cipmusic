\set ON_ERROR_STOP on

-- Compatibility tripwire for any automation that still invokes the historical
-- rollback-batch path. Post-commit destructive rollback is unsupported.
-- Run the rollback diagnostic separately for incident evidence; it never
-- authorizes this file or any other DROP path.
\ir 20260722010000_apple_entitlement_ledger_phase_1a_down.sql
