import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI not defined');
    }

    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000, // fail fast if cannot reach cluster
      socketTimeoutMS: 45000
    });

    console.log('MONGO CONNECTED');
  } catch (err) {
    console.error('MONGO CONNECTION FAILED');
    console.error(err.message);
    process.exit(1);
  }
};


export const isDbReady = () => mongoose.connection.readyState === 1;
export default connectDB;
