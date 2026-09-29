const VALID_STATUSES = ['todo', 'in_progress', 'done'];
const VALID_PRIORITIES = ['low', 'medium', 'high'];
const MAX_ASSIGNEE_LENGTH = 100;

// FIX (bug #6): these used to be guarded with `body.status && ...`, which skipped
// validation for falsy values — so `status: ""` or `priority: null` were stored
// verbatim. We now validate whenever the key is present at all.
const validateEnumFields = (body) => {
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return `status must be one of: ${VALID_STATUSES.join(', ')}`;
  }
  if (body.priority !== undefined && !VALID_PRIORITIES.includes(body.priority)) {
    return `priority must be one of: ${VALID_PRIORITIES.join(', ')}`;
  }
  // dueDate may be explicitly null (meaning "no due date"), so a truthy check is right here.
  if (body.dueDate && isNaN(Date.parse(body.dueDate))) {
    return 'dueDate must be a valid ISO date string';
  }
  return null;
};

const validateCreateTask = (body) => {
  if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
    return 'title is required and must be a non-empty string';
  }
  return validateEnumFields(body);
};

const validateUpdateTask = (body) => {
  if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim() === '')) {
    return 'title must be a non-empty string';
  }
  return validateEnumFields(body);
};

// `assignee: null` is allowed and means "unassign". Anything else must be a
// non-blank string of reasonable length (it's a display name, not free text).
const validateAssign = (body) => {
  const { assignee } = body;
  if (assignee === null) return null;
  if (typeof assignee !== 'string' || assignee.trim() === '') {
    return 'assignee is required and must be a non-empty string (or null to unassign)';
  }
  if (assignee.trim().length > MAX_ASSIGNEE_LENGTH) {
    return `assignee must be at most ${MAX_ASSIGNEE_LENGTH} characters`;
  }
  return null;
};

module.exports = { VALID_STATUSES, validateCreateTask, validateUpdateTask, validateAssign };
