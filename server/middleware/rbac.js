export const Roles = {
  CUSTOMER: 'CUSTOMER',
  DRIVER: 'DRIVER',
  ADMIN: 'ADMIN',
  OWNER: 'OWNER'
};

export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Normalize role
      const role = String(user.role || '').toUpperCase();

      // Owner override
      if (role === Roles.OWNER) {
        return next();
      }

      if (!allowedRoles.map(r => r.toUpperCase()).includes(role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      next();
    } catch (err) {
      console.error('RBAC ERROR:', err);
      return res.status(500).json({ error: 'RBAC failure' });
    }
  };
};
