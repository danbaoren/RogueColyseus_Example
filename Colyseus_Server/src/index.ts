import http from "http";
import express from "express";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import GameRoom from "./rooms/GameRoom";

const PORT = Number(process.env.PORT) || 2567;
const app = express();

const server = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server,              // re-use your HTTP server
    pingInterval: 6000,  // ms between pings (default 3000)
    pingMaxRetries: 4,   // how many pings can go unanswered (default 2)
    // maxPayload, verifyClient, etc. are also available here
  })
});

gameServer.define("game", GameRoom);

app.use("/monitor", monitor());

gameServer.listen(PORT).then(() => {
  console.log(`[GameServer] Listening on ws://localhost:${PORT}`);
  console.log(`[GameServer] Monitoring panel at http://localhost:${PORT}/monitor`);
});
