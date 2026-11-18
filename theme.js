// Applies the saved or system colour theme before first paint (kept in a file so the page needs no inline script).
try { var t = localStorage.getItem("lithopt-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); document.documentElement.dataset.theme = t; } catch (e) {}
