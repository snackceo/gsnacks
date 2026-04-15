require('dotenv').config();
const app = require('./app');
const connectDB = require('./db/connect');

const PORT = process.env.PORT || 5000;

(async () => {
  try {
    await connectDB();
    app.listen(PORT, () => console.log(`Server running on ${PORT}`));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();