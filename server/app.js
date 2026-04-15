const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

// Swagger
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

// OpenAPI Validator (THIS is the key part)
const { OpenApiValidator } = require('express-openapi-validator');

const app = express();

app.use(helmet());
app.use(express.json({ limit: '10kb' }));

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// ----------------------
// 1. LOAD OPENAPI FILE
// ----------------------
const apiSpec = path.join(__dirname, 'docs', 'receipt-api.yaml');

// ----------------------
// 2. SWAGGER UI (docs only)
// ----------------------
const swaggerDocument = YAML.load(apiSpec);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// ----------------------
// 3. OPENAPI VALIDATION (BEFORE ROUTES)
// ----------------------
new OpenApiValidator({
  apiSpec,
  validateRequests: true,   // ✅ blocks bad input
  validateResponses: false, // optional (can turn on later)
}).install(app).then(() => {

  // ----------------------
  // 4. ROUTES (AFTER VALIDATION)
  // ----------------------
  app.use('/api/v1', routes);

  // ----------------------
  // 5. ERROR HANDLER (MUST BE LAST)
  // ----------------------
  app.use(errorHandler);

});

module.exports = app;