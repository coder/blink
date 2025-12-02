import React from "react";

import whyDidYouRender from "@welldone-software/why-did-you-render";

console.debug(
  "Applying whyDidYouRender, to help you locate unnecessary re-renders during development. See https://github.com/welldone-software/why-did-you-render"
);

// See https://github.com/welldone-software/why-did-you-render#options
whyDidYouRender(React, {
  trackAllPureComponents: true,
  trackHooks: true,
  logOwnerReasons: true,
  collapseGroups: true,
  include: [/./],

  // This is for testing, remove it, if you don't want to log on different values
  logOnDifferentValues: true,
});
