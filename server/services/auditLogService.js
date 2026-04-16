const AuditLog = require('../models/AuditLog.js');

/**
 * Records an action in the audit log.
 * @param {object} logData - The data to log.
 * @param {string} logData.actorId - The ID of the user performing the action.
 * @param {string} logData.action - A description of the action (e.g., 'USER_ROLE_UPDATED').
 * @param {string} [logData.targetType] - The type of entity being acted upon.
 * @param {string} [logData.targetId] - The ID of the entity being acted upon.
 * @param {object} [logData.details] - Any additional details about the action.
 */
exports.recordAuditLog = async (logData) => {
  await AuditLog.create({ actor: logData.actorId, ...logData });
};