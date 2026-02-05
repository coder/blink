/**
 * Returns whether multi-org functionality is enabled.
 * When false, users cannot create new organizations or delete existing ones.
 */
export const getEnableMultiOrg = (): boolean => {
  return process.env.SELF_HOSTED !== "true";
};
