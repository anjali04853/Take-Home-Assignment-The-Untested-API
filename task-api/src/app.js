const express = require('express');
const taskRoutes = require('./routes/tasks');

const app = express();

app.use(express.json());

// Small index so the deployed root URL is self-describing instead of a bare 404.
// Also used as the health-check path on Render.
app.get('/', (req, res) => {
  res.json({
    name: 'Task API',
    endpoints: [
      'GET    /tasks?status=&page=&limit=',
      'POST   /tasks',
      'GET    /tasks/stats',
      'PUT    /tasks/:id',
      'DELETE /tasks/:id',
      'PATCH  /tasks/:id/complete',
      'PATCH  /tasks/:id/assign',
    ],
    note: 'In-memory store: data resets whenever the server restarts.',
  });
});
app.use('/tasks', taskRoutes);

app.use((err, req, res, next) => {
  // FIX (bug #5): body-parser throws on malformed JSON with err.type set.
  // That's a client error, so answer 400 instead of falling through to 500.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Task API running on port ${PORT}`);
  });
}

module.exports = app;
