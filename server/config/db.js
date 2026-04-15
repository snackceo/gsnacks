import mongoose from 'mongoose';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

const connectDB = async (retryCount = 0) => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI not defined');
    }

    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 2,
      retryWrites: true,
      retryReads: true
    });

    console.log('MONGO CONNECTED');

    mongoose.connection.on('error', (err) => {
      console.error('MONGO ERROR:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MONGO DISCONNECTED - attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MONGO RECONNECTED');
    });
  } catch (err) {
    console.error('MONGO CONNECTION FAILED');
    console.error(err.message);

    if (retryCount < MAX_RETRIES) {
      console.log(
        `Retrying connection in ${RETRY_DELAY_MS / 1000}s... (Attempt ${retryCount + 1}/${MAX_RETRIES})`
      );
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      return connectDB(retryCount + 1);
    }

    console.error('Max retries reached. Exiting...');
    process.exit(1);
  }
};

export default connectDB;
