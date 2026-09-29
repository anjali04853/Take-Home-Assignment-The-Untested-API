// Unit tests for the pure validation helpers. Each returns an error string or null.
const { validateCreateTask, validateUpdateTask, validateAssign } = require('../src/utils/validators');

describe('validateCreateTask', () => {
  it('accepts a minimal valid body', () => {
    expect(validateCreateTask({ title: 'ok' })).toBeNull();
  });

  it('accepts a fully populated valid body', () => {
    expect(
      validateCreateTask({ title: 'ok', status: 'in_progress', priority: 'low', dueDate: '2030-05-01T10:00:00Z' })
    ).toBeNull();
  });

  it.each([
    ['missing', {}],
    ['empty', { title: '' }],
    ['whitespace only', { title: '   ' }],
    ['non-string', { title: 42 }],
  ])('rejects a %s title', (_, body) => {
    expect(validateCreateTask(body)).toMatch(/title/);
  });

  it('rejects an unknown status', () => {
    expect(validateCreateTask({ title: 'ok', status: 'pending' })).toMatch(/status/);
  });

  it('rejects an unknown priority', () => {
    expect(validateCreateTask({ title: 'ok', priority: 'urgent' })).toMatch(/priority/);
  });

  it('rejects an unparseable dueDate', () => {
    expect(validateCreateTask({ title: 'ok', dueDate: 'next tuesday' })).toMatch(/dueDate/);
  });

  // BUG #6 regression: `if (body.status && ...)` skipped validation for falsy
  // values, so "" / null got stored verbatim and broke filters and stats.
  it.each([
    ['status', ''],
    ['status', null],
    ['priority', ''],
    ['priority', null],
  ])('rejects %s = %p', (field, value) => {
    expect(validateCreateTask({ title: 'ok', [field]: value })).toMatch(field);
  });

  it('allows dueDate to be explicitly null', () => {
    expect(validateCreateTask({ title: 'ok', dueDate: null })).toBeNull();
  });
});

describe('validateUpdateTask', () => {
  it('accepts an empty body (nothing to change)', () => {
    expect(validateUpdateTask({})).toBeNull();
  });

  it('accepts a valid partial update', () => {
    expect(validateUpdateTask({ status: 'done', priority: 'high' })).toBeNull();
  });

  it('rejects an empty title when title is present', () => {
    expect(validateUpdateTask({ title: '  ' })).toMatch(/title/);
  });

  it('rejects invalid status, priority and dueDate', () => {
    expect(validateUpdateTask({ status: 'nope' })).toMatch(/status/);
    expect(validateUpdateTask({ priority: 'nope' })).toMatch(/priority/);
    expect(validateUpdateTask({ dueDate: 'nope' })).toMatch(/dueDate/);
  });

  it('rejects status = "" (BUG #6)', () => {
    expect(validateUpdateTask({ status: '' })).toMatch(/status/);
  });
});

describe('validateAssign', () => {
  it('accepts a non-empty name', () => {
    expect(validateAssign({ assignee: 'Alice' })).toBeNull();
  });

  it('accepts null (unassign)', () => {
    expect(validateAssign({ assignee: null })).toBeNull();
  });

  it.each([
    ['missing', {}],
    ['empty', { assignee: '' }],
    ['whitespace only', { assignee: '   ' }],
    ['a number', { assignee: 7 }],
    ['an object', { assignee: { name: 'Alice' } }],
    ['too long', { assignee: 'a'.repeat(101) }],
  ])('rejects an assignee that is %s', (_, body) => {
    expect(validateAssign(body)).toMatch(/assignee/);
  });
});
