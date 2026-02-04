export const getEmailDeliveryConfigured = (): boolean => {
  return process.env.BLINK_EMAIL_DELIVERY_CONFIGURED === "true";
};
