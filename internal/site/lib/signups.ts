import { cache } from "react";
import { getQuerier } from "@/lib/database";

export type PublicSignupStatus = {
  enableSignups: boolean;
  isFirstUser: boolean;
  allowPublicSignups: boolean;
};

export type PublicSignupFlag = {
  enableSignups: boolean;
};

export const getPublicSignupFlag = (): PublicSignupFlag => {
  return {
    enableSignups: process.env.BLINK_ENABLE_SIGNUPS === "true",
  };
};

export const getPublicSignupStatus = cache(
  async (): Promise<PublicSignupStatus> => {
    const { enableSignups } = getPublicSignupFlag();
    const db = await getQuerier();
    const teamOrgs = await db.selectTeamOrganizations();
    let isFirstUser = teamOrgs.length === 0;

    if (isFirstUser) {
      const users = await db.selectAllUsers({ page: 1, per_page: 1 });
      isFirstUser = users.items.length === 0;
    }

    return {
      enableSignups,
      isFirstUser,
      allowPublicSignups: enableSignups || isFirstUser,
    };
  }
);
