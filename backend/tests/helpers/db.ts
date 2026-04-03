import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let mongoServer: MongoMemoryReplSet | null = null;
let isConnecting = false;

export const connectTestDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (isConnecting) {
    return;
  }

  isConnecting = true;

  try {
    mongoServer = await MongoMemoryReplSet.create({
      binary: {
        version: process.env.MONGOMS_VERSION || '7.0.14',
      },
      replSet: {
        count: 1,
        storageEngine: 'wiredTiger',
      },
    });
    await mongoose.connect(mongoServer.getUri());
  } finally {
    isConnecting = false;
  }
};

export const clearTestDatabase = async (): Promise<void> => {
  const { collections } = mongoose.connection;

  await Promise.all(
    Object.values(collections).map(async (collection) => {
      await collection.deleteMany({});
    })
  );
};

export const disconnectTestDatabase = async (): Promise<void> => {
  await mongoose.disconnect();

  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
};
