# Submission Notes

- **Bug report:** [BUG_REPORT.md](./BUG_REPORT.md)
- **Tests:** [`task-api/tests/`](./task-api/tests)
- **Live API:** _see the link in the submission email_ (Render free tier: the first request after it has been idle can take ~30s while the instance wakes up)

## How I worked

1. I read all four source files end to end, then probed the running app with a small Supertest script to confirm my suspicions before writing any test.
2. I wrote the tests to describe **correct** behaviour and ran them against the untouched code. 45 of 87 failed, and every failure traced back to a known bug, the missing `assignee` field, or the unbuilt `/assign` endpoint. Nothing failed for an unexpected reason.
3. I fixed the bugs and implemented `/assign` until the suite went green. Each fix has a `// FIX (bug #N)` comment in the source that points back to the bug report.

## Tests & coverage

| File | What it covers |
|---|---|
| `tests/taskService.test.js` | Unit tests for every service function, including bug regressions |
| `tests/validators.test.js` | Unit tests for the validation helpers (table-driven with `it.each`) |
| `tests/tasks.routes.test.js` | Supertest integration tests for every existing endpoint, plus error handling |
| `tests/assign.test.js` | The new `PATCH /tasks/:id/assign` endpoint |

```
$ npm run coverage

-----------------|---------|----------|---------|---------|-------------------
File             | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-----------------|---------|----------|---------|---------|-------------------
All files        |   98.82 |    97.72 |   96.96 |    98.7 |
 src             |   88.23 |    83.33 |   66.66 |   88.23 |
  app.js         |   88.23 |    83.33 |   66.66 |   88.23 | 40-41
 src/routes      |     100 |      100 |     100 |     100 |
  tasks.js       |     100 |      100 |     100 |     100 |
 src/services    |     100 |    94.73 |     100 |     100 |
  taskService.js |     100 |    94.73 |     100 |     100 | 30
 src/utils       |     100 |      100 |     100 |     100 |
  validators.js  |     100 |      100 |     100 |     100 |
-----------------|---------|----------|---------|---------|-------------------
Tests:       88 passed, 88 total
```

The only uncovered lines are the `app.listen(...)` block, which runs only when the file is started directly (`require.main === module`), and one branch in `getStats` for tasks with an unknown status. Since bug #6 is fixed, that state can't be reached through the API anymore.

The tests reset the in-memory store with `taskService._reset()` in `beforeEach`, so every test starts clean and they don't depend on each other's order.

## Bug fixes

The brief asks for one fix. I fixed #1–#7 (plus the README), because each one was small, covered by a failing test, and low-risk. I **deliberately did not** fix #8–#10: each needs an API or product decision (the response shape for filtered pagination, who owns `completedAt`, how strict dates should be). Details and proposed fixes are in the bug report.

## Feature: `PATCH /tasks/:id/assign`

```
PATCH /tasks/:id/assign
Body: { "assignee": "Alice" }     → 200, the updated task
Body: { "assignee": null }        → 200, unassigns
```

| Situation | Response |
|---|---|
| Unassigned task, valid name | `200` + updated task |
| Already assigned to the **same** name | `200` (idempotent no-op) |
| Already assigned to **someone else** | `409 Conflict`: "already assigned to Alice. Unassign it first" |
| `assignee: null` | `200`, clears the assignee |
| `assignee` missing, `""`, whitespace, non-string, > 100 chars | `400` |
| Task doesn't exist | `404` |

**Design decisions:**

- **Empty or whitespace names return 400, not "unassign".** An empty string is almost always a client bug (an empty form field). Unassigning is a deliberate action, so it gets an explicit value: `null`. That keeps "I meant to clear it" separate from "I forgot to fill it in".
- **Reassigning to a different person returns 409.** The brief asks what should happen when a task is already assigned. Silently overwriting would let two people grab the same task without noticing, so the client has to unassign first. Re-sending the same name returns 200, so retries are safe. **Tradeoff:** a manager reassigning work now needs two calls. In a real product I'd probably allow direct reassignment for users with the right permission, or accept an `If-Match`/`force` flag. That's the first thing I'd ask the product owner.
- **Names are trimmed and capped at 100 characters.** `"  Alice "` and `"Alice"` shouldn't count as different people, and there has to be *some* upper bound on stored input.
- **Every task has `assignee: null` from creation**, so clients always see the same response shape instead of the key sometimes being missing.
- **`assignee` can't be set through `PUT`.** Assignment has its own rules (the 409 check), and letting `PUT` bypass them would make those rules meaningless. `PUT`'s field whitelist (fix #4) handles this.
- **Validation runs before the existence check** (400 before 404), which matches the existing `PUT` handler.
- **The conflict rule lives in the route, and the write lives in the service** (`assignTask`). The service stays a simple data-access layer, like the other functions in it.
- **Completed tasks can still be assigned.** I didn't want to invent a rule the brief doesn't ask for. It's listed as an open question below.

## What surprised me

- **`String#includes` vs `Array#includes`** (bug #2). It reads correctly at a glance, which is why it would survive code review without a test.
- **`id` can be overwritten through `PUT`** (bug #4). That turns a cosmetic endpoint into a way to make data disappear.
- **The README and the code disagree about status values**, so a client following the docs could never set a status successfully.
- **`completeTask` quietly resets priority.** A one-line side effect that nobody would ever notice by hand.

## What I'd test next with more time

- **Combined query params** (`?status=todo&page=2&limit=5`), after deciding the contract for bug #8.
- **`completedAt` lifecycle** across `PUT` / `/complete` transitions (bug #9), probably as a small state-transition table test.
- **Property-based tests** for pagination (e.g. with `fast-check`): for any N, page and limit, the concatenated pages equal the full list, with no duplicates or gaps.
- **Request-level edge cases:** a non-JSON `Content-Type`, very large bodies (the `express.json` limit), and unicode or emoji in names.
- **Concurrency:** two assign requests racing. That's trivial with an in-memory store, but it matters once there's a real DB.

## Questions before shipping to production

1. **Persistence:** the store is in memory, so every deploy or restart wipes all data. Which database are we using, and who owns the migration?
2. **Auth:** there's none. Who is allowed to create, delete, or reassign tasks? Should `assignee` be a free-text name or a reference to a real user id?
3. **Reassignment policy:** is the 409 behaviour right, or should certain roles be able to reassign directly?
4. **List contract:** should `GET /tasks` return pagination metadata (`total`, `page`, `hasNext`)? Clients currently can't tell when they've reached the last page.
5. **`PUT` semantics:** the README calls it a "full update", but it behaves like a partial update (really `PATCH`). Which one do clients expect?
6. **Operational basics:** rate limiting, request logging, CORS, security headers (`helmet`), and a real health check.
