const { v4: uuidv4 } = require('uuid');

let tasks = [];

// Fields a client may change through update() / PUT. Everything else (id,
// createdAt, completedAt, assignee) is managed by the server or by its own endpoint.
const UPDATABLE_FIELDS = ['title', 'description', 'status', 'priority', 'dueDate'];

const getAll = () => [...tasks];

const findById = (id) => tasks.find((t) => t.id === id);

// FIX (bug #2): was `t.status.includes(status)` — a substring match, so "do"
// matched both "todo" and "done" and "" matched every task.
const getByStatus = (status) => tasks.filter((t) => t.status === status);

// `page` is 1-based (page=1 is the first page).
// FIX (bug #1): was `page * limit`, which skipped the whole first page.
const getPaginated = (page, limit) => {
  const offset = (page - 1) * limit;
  return tasks.slice(offset, offset + limit);
};

const getStats = () => {
  const now = new Date();
  const counts = { todo: 0, in_progress: 0, done: 0 };
  let overdue = 0;

  tasks.forEach((t) => {
    if (counts[t.status] !== undefined) counts[t.status]++;
    if (t.dueDate && t.status !== 'done' && new Date(t.dueDate) < now) {
      overdue++;
    }
  });

  return { ...counts, overdue };
};

const create = ({ title, description = '', status = 'todo', priority = 'medium', dueDate = null }) => {
  const task = {
    id: uuidv4(),
    title,
    description,
    status,
    priority,
    dueDate,
    completedAt: null,
    assignee: null, // always present so every task has the same shape
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  return task;
};

const update = (id, fields) => {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;

  // FIX (bug #4): was `{ ...tasks[index], ...fields }`, which let the request
  // body overwrite id / createdAt / completedAt or add arbitrary keys.
  const allowed = Object.fromEntries(
    Object.entries(fields).filter(([key]) => UPDATABLE_FIELDS.includes(key))
  );
  const updated = { ...tasks[index], ...allowed };
  tasks[index] = updated;
  return updated;
};

const remove = (id) => {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return false;

  tasks.splice(index, 1);
  return true;
};

const completeTask = (id) => {
  const task = findById(id);
  if (!task) return null;

  const updated = {
    ...task,
    // FIX (bug #3): this used to also set `priority: 'medium'`, silently
    // discarding the task's real priority on completion.
    status: 'done',
    completedAt: new Date().toISOString(),
  };

  const index = tasks.findIndex((t) => t.id === id);
  tasks[index] = updated;
  return updated;
};

// Sets (or clears, with null) the assignee. Conflict rules live in the route
// layer; this function just performs the write.
const assignTask = (id, assignee) => {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;

  const updated = { ...tasks[index], assignee };
  tasks[index] = updated;
  return updated;
};

const _reset = () => {
  tasks = [];
};

module.exports = {
  getAll,
  findById,
  getByStatus,
  getPaginated,
  getStats,
  create,
  update,
  remove,
  completeTask,
  assignTask,
  _reset,
};
