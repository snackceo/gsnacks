import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary with environment variables
// Supports two formats:
// 1. Individual fields: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// 2. URL format: CLOUDINARY_URL=cloudinary://key:secret@cloud_name

const hasIndividualFields = process.env.CLOUDINARY_CLOUD_NAME && 
                            process.env.CLOUDINARY_API_KEY && 
                            process.env.CLOUDINARY_API_SECRET;

const hasUrlFormat = process.env.CLOUDINARY_URL;

if (hasIndividualFields) {
  // Use individual fields
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
} else if (hasUrlFormat) {
  // Use CLOUDINARY_URL format (Cloudinary library parses it automatically)
  cloudinary.config({
    url: process.env.CLOUDINARY_URL,
    secure: true,
  });
}

// Check if Cloudinary is properly configured (supports both formats)
export const isCloudinaryConfigured = () => {
  return Boolean(
    (process.env.CLOUDINARY_CLOUD_NAME && 
     process.env.CLOUDINARY_API_KEY && 
     process.env.CLOUDINARY_API_SECRET) ||
    process.env.CLOUDINARY_URL
  );
};

export default cloudinary;
