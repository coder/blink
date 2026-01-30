"use client";

import { lazy, Suspense } from "react";
import Loading from "./loading";

const SiteUsersPage = lazy(() =>
  import("../site-users-page").then((mod) => ({ default: mod.SiteUsersPage }))
);

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <SiteUsersPage />
    </Suspense>
  );
}
