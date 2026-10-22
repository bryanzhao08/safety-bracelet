// Preserve other warnings while hiding Node 24's known node:sqlite startup notice.
process.removeAllListeners('warning');
process.on('warning', warning => {
  if (warning.name === 'ExperimentalWarning' &&
      warning.message === 'SQLite is an experimental feature and might change at any time') return;
  console.warn(warning.stack || `${warning.name}: ${warning.message}`);
});
