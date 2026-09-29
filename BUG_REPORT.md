# Bug Report

Every bug below was **reproduced by a failing test first** (run against the original code), then fixed or documented. File/line references point at the original code in the `feat: initial project setup` commit.

| # | Bug | Severity | Status |
|---|-----|----------|--------|
| 1 | Pagination skips the first page | High | ✅ Fixed |
| 2 | Status filter does substring matching | High | ✅ Fixed |
| 3 | Completing a task resets its priority | Medium | ✅ Fixed |
| 4 | `PUT` can overwrite `id`, `createdAt`, `completedAt`, or add arbitrary keys | High | ✅ Fixed |
| 5 | Malformed JSON returns 500 instead of 400 | Medium | ✅ Fixed |
| 6 | Falsy `status` / `priority` bypass validation | Medium | ✅ Fixed |
| 7 | Negative `page` returns tasks from the end of the list | Low | ✅ Fixed |
| 8 | `status` filter and pagination can't be combined | Low | 📝 Documented |
| 9 | `completedAt` gets out of sync with `status` | Medium | 📝 Documented |
| 10 | `dueDate` / `description` types aren't really validated | Low | 📝 Documented |
| 11 | README documents the wrong status values | Low (docs) | ✅ Fixed |

---

## 1. Pagination skips the first page

**Where:** `src/services/taskService.js` — `getPaginated`, `const offset = page * limit;`

**Expected:** `GET /tasks?page=1&limit=2` returns tasks 1–2.
**Actual:** Returns tasks 3–4. Page 1 is really page 2, and the first `limit` tasks can't be reached at all (the route turns `page=0` into `1` via `parseInt(page) || 1`).

**Why:** The route treats `page` as 1-based (default is `1`), but the service computes the offset as if it were 0-based.

**Found by:** `taskService.test.js › getPaginated › treats page as 1-based` and `tasks.routes.test.js › returns the first page for page=1`.

**Fix:** `const offset = (page - 1) * limit;`

---

## 2. Status filter does substring matching

**Where:** `src/services/taskService.js` — `getByStatus`, `t.status.includes(status)`

**Expected:** `?status=do` is either rejected or returns nothing.
**Actual:** Returns every `todo` **and** `done` task. `?status=o` returns everything, and so does `in` for `in_progress`.

**Why:** `String.prototype.includes` is a substring check, not an equality check. Most likely a mix-up with `Array.prototype.includes`.

**Found by:** `taskService.test.js › getByStatus › does not do substring matching`.

**Fix:** Use `t.status === status` in the service. I also made the route validate `status` against `VALID_STATUSES` and return **400** for unknown values, so a typo like `?status=complete` gets a clear error instead of a quiet `[]`.

---

## 3. Completing a task resets its priority

**Where:** `src/services/taskService.js` — `completeTask`, `priority: 'medium'` inside the spread

**Expected:** `PATCH /tasks/:id/complete` changes `status` and `completedAt` and nothing else.
**Actual:** A `high` or `low` priority task comes back as `medium`.

**Why:** A hard-coded `priority: 'medium'` in the object literal overrides `...task`. It looks like leftover or copy-pasted code; nothing in the spec asks for it.

**Found by:** `taskService.test.js › completeTask › does not change the task priority`.

**Fix:** Removed the line.

---

## 4. `PUT` lets clients overwrite server-managed fields

**Where:** `src/services/taskService.js` — `update`, `const updated = { ...tasks[index], ...fields };` with `fields = req.body`

**Expected:** `id`, `createdAt` and `completedAt` belong to the server. Unknown keys are ignored.
**Actual:** `PUT /tasks/:id {"id":"hijacked"}` returns 200 and the task now *lives at a different id*, so the original URL 404s. `createdAt` can be backdated, and arbitrary keys (`{"isAdmin": true}`) get stored on the task. This is a textbook mass-assignment bug.

**Why:** The whole request body is spread onto the stored object, and the validator only checks the fields it knows about.

**Found by:** `taskService.test.js › update › ignores server-managed and unknown fields` and `tasks.routes.test.js › cannot overwrite the id or createdAt`.

**Fix:** Whitelist the updatable fields (`title`, `description`, `status`, `priority`, `dueDate`) in the service, so any other caller of `update()` is protected too, not just this one route.

---

## 5. Malformed JSON returns 500

**Where:** `src/app.js` — the global error handler

**Expected:** `400 Bad Request`. The client sent bad input.
**Actual:** `500 {"error":"Internal server error"}`, plus a stack trace in the server log.

**Why:** `express.json()` throws a `SyntaxError` with `err.type === 'entity.parse.failed'`, and the only error handler maps *everything* to 500.

**Found by:** Probing with a truncated body, then `tasks.routes.test.js › returns 400 (not 500) for malformed JSON`.

**Fix:** Check for `err.type === 'entity.parse.failed'` in the error handler and return 400.

---

## 6. Falsy `status` / `priority` bypass validation

**Where:** `src/utils/validators.js` — `if (body.status && !VALID_STATUSES.includes(...))` (same for `priority`)

**Expected:** `POST /tasks {"title":"x","status":""}` → 400.
**Actual:** 201, and the task is stored with `status: ""`, which isn't a valid state. `null` behaves the same way. Default parameters in `create()` don't help, because defaults only apply to `undefined`. These tasks then disappear from every status filter and from `/stats` counts.

**Why:** A truthy check stands in for a "was this key provided?" check.

**Found by:** `validators.test.js › rejects status = "" / null`, etc.

**Fix:** Validate when `body.status !== undefined`. `dueDate` keeps the truthy check on purpose, because `dueDate: null` is a legitimate "no due date".

---

## 7. Negative `page` returns tasks from the end

**Where:** `src/routes/tasks.js` — `parseInt(page) || 1` only replaces `NaN`/`0`, so `-1` passes through.

**Actual:** After fixing #1, `page=-1&limit=2` gives `offset = -4`, and `Array#slice(-4, -2)` counts from the **end** of the array. The client gets an arbitrary slice of data. `limit` had no upper bound either, so `limit=1000000` was accepted.

**Fix:** Clamp `page` to at least 1 and `limit` to 1–100 in the route. Test: `clamps page < 1 to the first page`.

---

## 8. `status` filter and pagination can't be combined (not fixed)

**Where:** `src/routes/tasks.js` — the `if (status) return ...` branch runs before the pagination branch.

**Actual:** `GET /tasks?status=todo&limit=1` returns **all** todo tasks. `page`/`limit` are silently ignored.

**Proposed fix:** Build the list as a pipeline (filter → paginate) instead of mutually exclusive branches. For example, `getPaginated` could take the already-filtered array, or `getAll({ status, page, limit })` could handle all three. I left it because it changes the service's API shape, and I'd want to agree on the list contract first (e.g. whether to return `{ data, total, page }` metadata).

---

## 9. `completedAt` gets out of sync with `status` (not fixed)

**Where:** `src/services/taskService.js` — `update` and `completeTask`

**Actual:**
- `PUT {"status":"done"}` → `status: done`, `completedAt: null`.
- Complete a task, then `PUT {"status":"todo"}` → `status: todo`, but `completedAt` still holds the old timestamp.
- Calling `/complete` twice overwrites the original completion time.

**Proposed fix:** Make `completedAt` derived state that `update()` maintains. Set it when status changes *to* `done` (if it isn't already set), and clear it when status changes *away* from `done`. Alternatively, forbid `status: done` through `PUT` so `/complete` is the only way to complete a task. That's a product decision, so I left it open.

---

## 10. Weak type validation on `dueDate` and `description` (not fixed)

**Where:** `src/utils/validators.js`

**Actual:** `{"title":"x","dueDate":12345,"description":42}` → 201. `Date.parse(12345)` coerces the number to the string `"12345"`, which V8 reads as a valid year, and the number is stored as-is. `description` is never type-checked. Non-ISO strings like `"March 5"` also pass, because `Date.parse` is lenient.

**Proposed fix:** Require `typeof dueDate === 'string'` plus a strict ISO-8601 check (or normalise it with `new Date(x).toISOString()` before storing), and require `description` to be a string.

---

## 11. README documents the wrong status values (docs)

`README.md` listed statuses as `pending | in-progress | completed`, but the code (and `ASSIGNMENT.md`) use `todo | in_progress | done`. A client following the README would get a 400 on every create that sets a status. I updated the README.
