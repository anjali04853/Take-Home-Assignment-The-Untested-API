// Tests for the new PATCH /tasks/:id/assign endpoint.
// Written before the implementation; see NOTES.md for the design decisions
// these tests encode (409 on conflicting reassignment, null to unassign, etc.).
const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

beforeEach(() => {
  taskService._reset();
});

const newTask = async () => (await request(app).post('/tasks').send({ title: 'Assign me' })).body;
const assign = (id, body) => request(app).patch(`/tasks/${id}/assign`).send(body);

describe('PATCH /tasks/:id/assign', () => {
  describe('happy path', () => {
    it('assigns an unassigned task and returns the updated task', async () => {
      const task = await newTask();
      const res = await assign(task.id, { assignee: 'Alice' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: task.id, title: 'Assign me', assignee: 'Alice' });
    });

    it('persists the assignee', async () => {
      const task = await newTask();
      await assign(task.id, { assignee: 'Alice' });

      const list = await request(app).get('/tasks');
      expect(list.body[0].assignee).toBe('Alice');
    });

    it('trims surrounding whitespace from the name', async () => {
      const task = await newTask();
      const res = await assign(task.id, { assignee: '  Alice  ' });

      expect(res.body.assignee).toBe('Alice');
    });

    it('does not touch other fields', async () => {
      const task = await newTask();
      const res = await assign(task.id, { assignee: 'Alice' });

      expect(res.body).toEqual({ ...task, assignee: 'Alice' });
    });
  });

  describe('already assigned', () => {
    it('is idempotent when re-assigning to the same person', async () => {
      const task = await newTask();
      await assign(task.id, { assignee: 'Alice' });
      const res = await assign(task.id, { assignee: 'Alice' });

      expect(res.status).toBe(200);
      expect(res.body.assignee).toBe('Alice');
    });

    it('returns 409 when the task is already assigned to someone else', async () => {
      const task = await newTask();
      await assign(task.id, { assignee: 'Alice' });
      const res = await assign(task.id, { assignee: 'Bob' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/Alice/);
      // And the original assignment is untouched.
      expect((await request(app).get('/tasks')).body[0].assignee).toBe('Alice');
    });

    it('allows reassignment after explicitly unassigning with null', async () => {
      const task = await newTask();
      await assign(task.id, { assignee: 'Alice' });

      const cleared = await assign(task.id, { assignee: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.assignee).toBeNull();

      const res = await assign(task.id, { assignee: 'Bob' });
      expect(res.status).toBe(200);
      expect(res.body.assignee).toBe('Bob');
    });
  });

  describe('validation', () => {
    it.each([
      ['missing', {}],
      ['an empty string', { assignee: '' }],
      ['whitespace only', { assignee: '   ' }],
      ['a number', { assignee: 123 }],
      ['an array', { assignee: ['Alice'] }],
      ['longer than 100 chars', { assignee: 'x'.repeat(101) }],
    ])('returns 400 when assignee is %s', async (_, body) => {
      const task = await newTask();
      const res = await assign(task.id, body);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/assignee/);
    });
  });

  describe('not found', () => {
    it('returns 404 when the task does not exist', async () => {
      const res = await assign('does-not-exist', { assignee: 'Alice' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Task not found');
    });
  });
});
