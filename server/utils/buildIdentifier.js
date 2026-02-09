const BUILD_ID_ENV_KEYS = ['BACKEND_BUILD_ID', 'RELEASE_TAG', 'COMMIT_SHA', 'GIT_SHA'];

export const getBackendBuildIdentifier = () => {
  for (const envKey of BUILD_ID_ENV_KEYS) {
    const value = String(process.env?.[envKey] || '').trim();
    if (value) return value;
  }
  return 'unknown';
};

