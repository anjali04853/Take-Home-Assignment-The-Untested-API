// Integration tests: drive the real Express app over HTTP with Supertest and
// assert on status codes + response bodies (behaviour, not implementation).
const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

beforeEach(() => {
  taskService._reset();
});

const createTask = (body) => request(app).post('/tasks').send(body);

const createMany = async (n) => {
  const tasks = [];
  // Sequential on purpose, so insertion order (and therefore page order) is deterministic.
  for (let i = 1; i <= n; i++) {
    tasks.push((await createTask({ title: `Task ${i}` })).body);
  }
  return tasks;
};

describe('POST /tasks', () => {
  it('creates a task with defaults and returns 201', async () => {
    const res = await createTask({ title: 'Write tests' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Write tests',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
      assignee: null,
    });
    expect(res.body.id).toEqual(expect.any(String));
  });

  it('returns 400 when title is missing', async () => {
    const res = await createTask({ priority: 'high' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/);
  });

  it('returns 400 for an invalid status or priority', async () => {
    expect((await createTask({ title: 'x', status: 'pending' })).status).toBe(400);
    expect((await createTask({ title: 'x', priority: 'urgent' })).status).toBe(400);
  });

  it('returns 400 for an invalid dueDate', async () => {
    const res = await createTask({ title: 'x', dueDate: 'not-a-date' });
    expect(res.status).toBe(400);
  });

  // BUG #5 regression: malformed JSON used to fall through to the generic
  // error handler and come back as a 500.
  it('returns 400 (not 500) for malformed JSON', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('Content-Type', 'application/json')
      .send('{"title": ');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON/i);
  });
});

describe('GET /tasks', () => {
  it('returns an empty array when there are no tasks', async () => {
    const res = await request(app).get('/tasks');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all tasks', async () => {
    await createMany(3);
    const res = await request(app).get('/tasks');

    expect(res.body.map((t) => t.title)).toEqual(['Task 1', 'Task 2', 'Task 3']);
  });

  describe('?status=', () => {
    beforeEach(async () => {
      await createTask({ title: 'a', status: 'todo' });
      await createTask({ title: 'b', status: 'in_progress' });
      await createTask({ title: 'c', status: 'done' });
    });

    it('filters by exact status', async () => {
      const res = await request(app).get('/tasks?status=done');

      expect(res.status).toBe(200);
      expect(res.body.map((t) => t.title)).toEqual(['c']);
    });

    // BUG #2 regression (substring match) — now rejected up front.
    it('returns 400 for a partial / unknown status instead of fuzzy matching', async () => {
      const res = await request(app).get('/tasks?status=do');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/status/);
    });
  });

  describe('?page= & ?limit=', () => {
    // BUG #1 regression: page 1 used to return the *second* page.
    it('returns the first page for page=1', async () => {
      await createMany(5);
      const res = await request(app).get('/tasks?page=1&limit=2');

      expect(res.status).toBe(200);
      expect(res.body.map((t) => t.title)).toEqual(['Task 1', 'Task 2']);
    });

    it('returns subsequent pages', async () => {
      await createMany(5);
      const res = await request(app).get('/tasks?page=3&limit=2');

      expect(res.body.map((t) => t.title)).toEqual(['Task 5']);
    });

    it('defaults limit to 10 when only page is given', async () => {
      await createMany(12);
      const res = await request(app).get('/tasks?page=1');

      expect(res.body).toHaveLength(10);
    });

    // Previously page=-1 produced a negative offset, and Array#slice counts
    // negative indexes from the END, so it returned tasks from the tail.
    it('clamps page < 1 to the first page', async () => {
      await createMany(5);
      const res = await request(app).get('/tasks?page=-1&limit=2');

      expect(res.body.map((t) => t.title)).toEqual(['Task 1', 'Task 2']);
    });

    it('falls back to defaults for non-numeric values', async () => {
      await createMany(3);
      const res = await request(app).get('/tasks?page=abc&limit=xyz');

      expect(res.body).toHaveLength(3);
    });
  });
});

describe('GET /tasks/stats', () => {
  it('returns counts per status and the overdue count', async () => {
    await createTask({ title: 'late', dueDate: '2000-01-01T00:00:00.000Z' });
    await createTask({ title: 'wip', status: 'in_progress' });
    await createTask({ title: 'done late', status: 'done', dueDate: '2000-01-01T00:00:00.000Z' });

    const res = await request(app).get('/tasks/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todo: 1, in_progress: 1, done: 1, overdue: 1 });
  });

  it('is not shadowed by the /:id routes', async () => {
    // /stats is registered before /:id-style routes; make sure it stays that way.
    const res = await request(app).get('/tasks/stats');
    expect(res.body).toHaveProperty('overdue');
  });
});

describe('PUT /tasks/:id', () => {
  it('updates a task and returns it', async () => {
    const { body: task } = await createTask({ title: 'Old' });
    const res = await request(app).put(`/tasks/${task.id}`).send({ title: 'New', status: 'in_progress' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: task.id, title: 'New', status: 'in_progress' });

    const list = await request(app).get('/tasks');
    expect(list.body[0].title).toBe('New');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).put('/tasks/does-not-exist').send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid body', async () => {
    const { body: task } = await createTask({ title: 'Old' });
    const res = await request(app).put(`/tasks/${task.id}`).send({ title: '' });

    expect(res.status).toBe(400);
  });

  // BUG #4 regression: id could be overwritten, orphaning the task under a new id.
  it('cannot overwrite the id or createdAt', async () => {
    const { body: task } = await createTask({ title: 'Mine' });
    const res = await request(app)
      .put(`/tasks/${task.id}`)
      .send({ id: 'hijacked', createdAt: '1999-01-01T00:00:00.000Z' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(task.id);
    expect(res.body.createdAt).toBe(task.createdAt);
    expect((await request(app).put('/tasks/hijacked').send({})).status).toBe(404);
  });
});

describe('DELETE /tasks/:id', () => {
  it('deletes a task and returns 204 with no body', async () => {
    const { body: task } = await createTask({ title: 'Bye' });
    const res = await request(app).delete(`/tasks/${task.id}`);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await request(app).get('/tasks')).body).toEqual([]);
  });

  it('returns 404 for an unknown id, including a second delete', async () => {
    const { body: task } = await createTask({ title: 'Bye' });
    await request(app).delete(`/tasks/${task.id}`);

    expect((await request(app).delete(`/tasks/${task.id}`)).status).toBe(404);
  });
});

describe('PATCH /tasks/:id/complete', () => {
  it('marks a task done and sets completedAt', async () => {
    const { body: task } = await createTask({ title: 'Finish me', priority: 'high' });
    const res = await request(app).patch(`/tasks/${task.id}/complete`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.completedAt).toEqual(expect.any(String));
    // BUG #3 regression: priority must survive completion.
    expect(res.body.priority).toBe('high');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).patch('/tasks/nope/complete');
    expect(res.status).toBe(404);
  });
});

describe('GET /', () => {
  it('returns an API index (used as the deploy health check)', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body.endpoints).toContain('PATCH  /tasks/:id/assign');
  });
});

describe('error handling', () => {
  it('returns a JSON 500 for unexpected errors', async () => {
    const spy = jest.spyOn(taskService, 'getAll').mockImplementation(() => {
      throw new Error('boom');
    });
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).get('/tasks');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    spy.mockRestore();
    quiet.mockRestore();
  });
});
