const express = require('express');
const router = express.Router();
const taskService = require('../services/taskService');
const {
  VALID_STATUSES,
  validateCreateTask,
  validateUpdateTask,
  validateAssign,
} = require('../utils/validators');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

router.get('/stats', (req, res) => {
  const stats = taskService.getStats();
  res.json(stats);
});

router.get('/', (req, res) => {
  const { status, page, limit } = req.query;

  // `status !== undefined` (not a truthy check) so `?status=` is rejected
  // rather than silently ignored.
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    const tasks = taskService.getByStatus(status);
    return res.json(tasks);
  }

  if (page !== undefined || limit !== undefined) {
    // Clamp to sane bounds. Without this, page=-1 gives a negative offset and
    // Array#slice counts negative indexes from the end of the array.
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(MAX_LIMIT, Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT));
    const tasks = taskService.getPaginated(pageNum, limitNum);
    return res.json(tasks);
  }

  const tasks = taskService.getAll();
  res.json(tasks);
});

router.post('/', (req, res) => {
  const error = validateCreateTask(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const task = taskService.create(req.body);
  res.status(201).json(task);
});

router.put('/:id', (req, res) => {
  const error = validateUpdateTask(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const task = taskService.update(req.params.id, req.body);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
});

router.delete('/:id', (req, res) => {
  const deleted = taskService.remove(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.status(204).send();
});

router.patch('/:id/complete', (req, res) => {
  const task = taskService.completeTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
});

// Assign (or unassign, with `assignee: null`) a task. See NOTES.md for the design rationale.
router.patch('/:id/assign', (req, res) => {
  const error = validateAssign(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const task = taskService.findById(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const assignee = req.body.assignee === null ? null : req.body.assignee.trim();

  // Re-assigning to someone else must be explicit (unassign first) so two
  // people can't silently steal a task from each other. Same name = no-op, 200.
  if (task.assignee && assignee && task.assignee !== assignee) {
    return res.status(409).json({
      error: `Task is already assigned to ${task.assignee}. Unassign it first (assignee: null).`,
    });
  }

  res.json(taskService.assignTask(task.id, assignee));
});

module.exports = router;
