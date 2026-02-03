import { fn } from "storybook/test";
import type { PublicSignupFlag, PublicSignupStatus } from "./signups";

export const getPublicSignupFlag = fn<() => PublicSignupFlag>(() => ({
  enableSignups: true,
}));

export const getPublicSignupStatus = fn<() => Promise<PublicSignupStatus>>(
  async () => ({
    enableSignups: true,
    isFirstUser: false,
    allowPublicSignups: true,
  })
);

export type { PublicSignupFlag, PublicSignupStatus };
