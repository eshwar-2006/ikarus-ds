// Run in one process for restricted Windows environments without child spawning.
require('./engine.test.cjs');
require('./frontend.test.cjs');
require('./qualification.test.cjs');
require('./event-isolation.test.cjs');
require('./portal-worker.test.cjs');
