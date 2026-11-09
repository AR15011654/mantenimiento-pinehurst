// Service worker mínimo: permite instalar la app en el teléfono.
// No guarda copias de la app ni de los datos: todo se pide siempre al servidor,
// así nunca se trabaja con una versión vieja ni se simula estar en línea.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* pasa directo a la red */ });
