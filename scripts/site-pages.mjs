export const SITE_PAGES = Object.freeze([
  "index.html",
  "privacy.html",
  "terms.html",
  "accessibility.html",
  "404.html",
]);

export const INTERACTIVE_SITE_PAGES = Object.freeze(
  SITE_PAGES.filter((pageName) => pageName !== "404.html"),
);
