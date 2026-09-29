// Unit tests for the service layer — these call taskService directly, with no
// HTTP in between, so failures point straight at the business logic.
const taskService = require('../src/services/taskService');

beforeEach(() => {
  taskService._reset();
});

// Small helper so tests read as "given N tasks" rather than a wall of create() calls.
const seed = (n, overrides = {}) =>
  Array.from({ length: n }, (_, i) => taskService.create({ title: `Task ${i + 1}`, ...overrides }));

describe('create', () => {
  it('applies defaults for optional fields', () => {
    const task = taskService.create({ title: 'Write tests' });

    expect(task).toMatchObject({
      title: 'Write tests',
      description: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
      assignee: null,
    });
    expect(task.id).toEqual(expect.any(String));
    expect(new Date(task.createdAt).toISOString()).toBe(task.createdAt);
  });

  it('keeps provided values and generates unique ids', () => {
    const a = taskService.create({ title: 'A', status: 'in_progress', priority: 'high', dueDate: '2030-01-01T00:00:00.000Z' });
    const b = taskService.create({ title: 'B' });

    expect(a).toMatchObject({ status: 'in_progress', priority: 'high', dueDate: '2030-01-01T00:00:00.000Z' });
    expect(a.id).not.toBe(b.id);
    expect(taskService.getAll()).toHaveLength(2);
  });
});

describe('getAll / findById', () => {
  it('returns a copy of the list, so callers cannot mutate the store', () => {
    seed(2);
    const list = taskService.getAll();
    list.pop();

    expect(taskService.getAll()).toHaveLength(2);
  });

  it('finds a task by id and returns undefined for unknown ids', () => {
    const [task] = seed(1);

    expect(taskService.findById(task.id)).toEqual(task);
    expect(taskService.findById('nope')).toBeUndefined();
  });
});

describe('getByStatus', () => {
  it('returns only tasks with exactly that status', () => {
    taskService.create({ title: 'todo', status: 'todo' });
    taskService.create({ title: 'wip', status: 'in_progress' });
    taskService.create({ title: 'done', status: 'done' });

    expect(taskService.getByStatus('todo').map((t) => t.title)).toEqual(['todo']);
    expect(taskService.getByStatus('in_progress').map((t) => t.title)).toEqual(['wip']);
  });

  // BUG #2 regression: the original used String#includes, so "do" matched both
  // "todo" and "done", and "" matched everything.
  it('does not do substring matching', () => {
    taskService.create({ title: 'todo', status: 'todo' });
    taskService.create({ title: 'done', status: 'done' });

    expect(taskService.getByStatus('do')).toEqual([]);
    expect(taskService.getByStatus('')).toEqual([]);
  });
});

describe('getPaginated', () => {
  // BUG #1 regression: page is 1-based at the API level, but the original
  // computed offset = page * limit, so page 1 skipped the first page entirely.
  it('treats page as 1-based', () => {
    seed(5);

    expect(taskService.getPaginated(1, 2).map((t) => t.title)).toEqual(['Task 1', 'Task 2']);
    expect(taskService.getPaginated(2, 2).map((t) => t.title)).toEqual(['Task 3', 'Task 4']);
    expect(taskService.getPaginated(3, 2).map((t) => t.title)).toEqual(['Task 5']);
  });

  it('returns an empty array past the last page', () => {
    seed(3);
    expect(taskService.getPaginated(5, 10)).toEqual([]);
  });
});

describe('getStats', () => {
  it('returns zeroes for an empty store', () => {
    expect(taskService.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  it('counts by status and only counts unfinished past-due tasks as overdue', () => {
    const past = '2000-01-01T00:00:00.000Z';
    const future = '2999-01-01T00:00:00.000Z';
    taskService.create({ title: 'late', status: 'todo', dueDate: past });
    taskService.create({ title: 'late wip', status: 'in_progress', dueDate: past });
    taskService.create({ title: 'late but done', status: 'done', dueDate: past });
    taskService.create({ title: 'not due yet', status: 'todo', dueDate: future });
    taskService.create({ title: 'no due date', status: 'todo' });

    expect(taskService.getStats()).toEqual({ todo: 3, in_progress: 1, done: 1, overdue: 2 });
  });
});

describe('update', () => {
  it('merges the given fields and persists them', () => {
    const [task] = seed(1);
    const updated = taskService.update(task.id, { title: 'Renamed', priority: 'high' });

    expect(updated).toMatchObject({ id: task.id, title: 'Renamed', priority: 'high', status: 'todo' });
    expect(taskService.findById(task.id)).toEqual(updated);
  });

  it('returns null for an unknown id', () => {
    expect(taskService.update('nope', { title: 'x' })).toBeNull();
  });

  // BUG #4 regression: the original spread the raw request body over the task,
  // so a client could rewrite id / createdAt / completedAt or inject junk keys.
  it('ignores server-managed and unknown fields', () => {
    const [task] = seed(1);
    const updated = taskService.update(task.id, {
      id: 'hijacked',
      createdAt: '1999-01-01T00:00:00.000Z',
      completedAt: '1999-01-01T00:00:00.000Z',
      isAdmin: true,
      title: 'ok',
    });

    expect(updated.id).toBe(task.id);
    expect(updated.createdAt).toBe(task.createdAt);
    expect(updated.completedAt).toBeNull();
    expect(updated).not.toHaveProperty('isAdmin');
    expect(updated.title).toBe('ok');
    expect(taskService.findById('hijacked')).toBeUndefined();
  });
});

describe('remove', () => {
  it('deletes an existing task and returns true', () => {
    const [a, b] = seed(2);

    expect(taskService.remove(a.id)).toBe(true);
    expect(taskService.getAll()).toEqual([b]);
  });

  it('returns false for an unknown id', () => {
    expect(taskService.remove('nope')).toBe(false);
  });
});

describe('completeTask', () => {
  it('marks the task done and stamps completedAt', () => {
    const [task] = seed(1);
    const done = taskService.completeTask(task.id);

    expect(done.status).toBe('done');
    expect(new Date(done.completedAt).toISOString()).toBe(done.completedAt);
    expect(taskService.findById(task.id)).toEqual(done);
  });

  // BUG #3 regression: the original silently reset priority to "medium".
  it('does not change the task priority', () => {
    const task = taskService.create({ title: 'urgent', priority: 'high' });
    expect(taskService.completeTask(task.id).priority).toBe('high');
  });

  it('returns null for an unknown id', () => {
    expect(taskService.completeTask('nope')).toBeNull();
  });
});

describe('assignTask', () => {
  it('stores the assignee on the task', () => {
    const [task] = seed(1);
    const updated = taskService.assignTask(task.id, 'Alice');

    expect(updated.assignee).toBe('Alice');
    expect(taskService.findById(task.id).assignee).toBe('Alice');
  });

  it('can clear the assignee with null', () => {
    const [task] = seed(1);
    taskService.assignTask(task.id, 'Alice');

    expect(taskService.assignTask(task.id, null).assignee).toBeNull();
  });

  it('returns null for an unknown id', () => {
    expect(taskService.assignTask('nope', 'Alice')).toBeNull();
  });
});
