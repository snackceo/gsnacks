const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

// ✅ Swagger
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');

const app = express();

app.use(helmet());
app.use(express.json({ limit: '10kb' }));

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// ✅ Load Swagger file
const swaggerDocument = YAML.load(
  path.join(__dirname, 'docs', 'receipt-api.yaml')
);

// ✅ Serve Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// ✅ Your API
app.use('/api/v1', routes);

app.use(errorHandler);

module.exports = app;