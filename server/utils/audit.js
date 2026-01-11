import AuditLog from '../models/AuditLog.js';

const recordAuditLog = async ({ type, actorId, details }) => {
  try {
    await AuditLog.create({
      type: String(type || ''),
      actorId: String(actorId || ''),
      details: String(details || '')
    });
  } catch (err) {
    console.error('AUDIT LOG ERROR:', err);
  }
};

export { recordAuditLog };
