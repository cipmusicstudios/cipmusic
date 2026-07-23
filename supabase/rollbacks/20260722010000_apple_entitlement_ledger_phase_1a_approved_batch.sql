\set ON_ERROR_STOP on

-- Execute this file only through one psql process over a Direct connection or
-- a verified session-pooler connection. Never use a transaction pooler or split
-- the diagnostic preflight and destructive down across GUI/SQL Editor runs.
begin;
\ir ../verification/20260722010000_apple_entitlement_rollback_preflight.sql
\ir 20260722010000_apple_entitlement_ledger_phase_1a_down.sql
