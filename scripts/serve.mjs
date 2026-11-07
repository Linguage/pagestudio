import { createServer } from 'node:http';
import { BASE, createHandler } from '../lib/http.mjs';
import { createLibrary } from '../lib/library.mjs';

const library = createLibrary();
const server = createServer(createHandler(library));
server.listen(Number(process.env.DSH_HTML_CARDS_PORT || 8767), '127.0.0.1', () => {
  console.log('PageStudio http://127.0.0.1:' + server.address().port + BASE + '/');
});
process.once('SIGINT', () => server.close(() => library.close()));
