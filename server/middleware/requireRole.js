export default (roles = []) => {
  return (req, res, next) => {
    const user = req.user;

    if (!user || !user.role) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!roles.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
};
