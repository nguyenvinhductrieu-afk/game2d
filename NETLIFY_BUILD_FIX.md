# Netlify build fix

The previous Netlify failure was not a Netlify configuration problem anymore. npm correctly found the `client` workspace, but TypeScript 5.9 + the Socket.IO 4.8 generic overloads rejected the indexed `ServerToClientEvents[E]` listener type in `SocketClient.on/once`.

The adapter now exposes the strongly typed callback through `Parameters<ServerToClientEvents[E]>` and narrows the Socket.IO implementation type only at the adapter boundary. This preserves type safety for callers while avoiding the incompatible indexed generic overload.

Build command:

```bash
npm run build:client
```

Publish directory:

```text
client/dist
```
