import '@testing-library/jest-dom/vitest';

// jsdom has no layout: window.scrollTo only logs "Not implemented". The arc scrolls to the top on each moment change,
// so stub it (a test that asserts the scroll replaces it with its own spy).
window.scrollTo = (() => {}) as typeof window.scrollTo;
