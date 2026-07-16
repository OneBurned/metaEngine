# Queue reliability and parallel Worker safety

Calculation runs and optimization jobs share one PostgreSQL-backed queue. This
document describes the current P8 reliability rules that make it safe to run
more than one `MetaEngine.Worker` process against the same database.

## Atomic claim and lease

When a Worker takes a queued task, PostgreSQL selects it with
`FOR UPDATE SKIP LOCKED` inside a transaction. Only that Worker receives a new
`leaseId`; another Worker skips the locked task and may take the next one.

The task stores its attempt count, lease ID, heartbeat and optional retry time.
All progress and completion writes require the same lease ID. If a Worker is
late after its lease has expired, it cannot overwrite work already recovered by
another Worker.

## Recovery and retry

The Worker checks for expired leases every 10 seconds. The default lease lasts
120 seconds. A transient PostgreSQL timeout or an expired running lease is
returned to `queued` with exponential delay: 5, 10, then 20 seconds. Three
attempts are made by default. After that, a task becomes `interrupted` and its
reason remains visible.

The defaults are in `src/MetaEngine.Worker/appsettings.json` under
`JobProcessing`:

```json
{
  "LeaseDurationSeconds": 120,
  "MaximumAutomaticAttempts": 3,
  "InitialRetryDelaySeconds": 5
}
```

These values can be configured per Worker environment. Use a lease longer than
the expected interval between progress writes for the largest accepted job.

For an optimization with a pending stop request, recovery finishes it as
`stopped`. It is never requeued.

## Manual retry

`Admin` and `Researcher` can retry a `failed` or `interrupted` task. The UI
shows a retry action for the selected calculation or optimization job. The
corresponding workspace endpoints are:

```text
POST /api/v1/workspaces/{workspaceId}/calculation-runs/{runId}/retry
POST /api/v1/workspaces/{workspaceId}/optimization-jobs/{jobId}/retry
```

Manual retry resets the retry budget and queues the task as a new attempt while
keeping audit events for the earlier failure.

## Several Workers

Several identical Worker processes may now be started for the same connection
string. They do not execute the same claimed task. This is a correctness
foundation, not yet a capacity policy: the next deployment step will choose the
number of replicas, resource limits and monitoring thresholds for each
environment.
