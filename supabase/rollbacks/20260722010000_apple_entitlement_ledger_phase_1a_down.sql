-- Phase 1A post-commit rollback safety placeholder.
--
-- There is deliberately no destructive SQL down migration for Phase 1A.
-- Before COMMIT, PostgreSQL rolls back the explicit up-migration transaction on
-- any error, timeout, or operator ROLLBACK. After COMMIT, preserve the schema and
-- use a reviewed forward fix or restore the verified Production backup.
--
-- This file exists only as a fail-closed tripwire for operators and automation.
-- No database state, token, GUC, temporary object, attestation, or approval can
-- unlock it. It takes no locks and performs no DROP, DML, or history mutation.

\set ON_ERROR_STOP on

begin;

do $phase1a_post_commit_down_unsupported$
begin
  raise exception using
    errcode = '0A000',
    message = 'PHASE_1A_POST_COMMIT_DOWN_UNSUPPORTED',
    hint = 'Use forward fix or restore the verified Production backup.';
end
$phase1a_post_commit_down_unsupported$;

-- Unreachable with ON_ERROR_STOP. Kept only to make the transaction boundary
-- explicit to non-psql readers; connection teardown also rolls back the error.
rollback;
