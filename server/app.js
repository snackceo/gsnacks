const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(express.json({ limit: '10kb' }));

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

app.use('/api/v1', routes);

app.use(errorHandler);

module.exports = app;