import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI not defined');
    }

    await mongoose.connect(process.env.MONGO_URI);

    console.log('MONGO CONNECTED');
  } catch (err) {
    console.error('MONGO CONNECTION FAILED');
    console.error(err.message);
    process.exit(1);
  }
};

export default connectDB;
