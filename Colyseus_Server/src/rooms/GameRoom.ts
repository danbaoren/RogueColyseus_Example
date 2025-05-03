import { Room, Client } from "colyseus";
import { State, Player } from "./schema/State";

interface TransformData {
  pos_x: number;
  pos_y: number;
  pos_z: number;
  rot_x: number;
  rot_y: number;
  rot_z: number;
}

export class GameRoom extends Room<State> {
  state = new State();

  // Tick rate in MS
  //
  // Valorant 128 HZ -- 7.8125 ms
  // CSGO 64 HZ -- 15.625 ms   (CS2 -- sub-tick system)
  // Fortnite 30 HZ -- 33.33 ms
  patchRate = 33;


  onCreate(options: any) {
    console.log("GameRoom created!", options);

    // handle incoming transform updates
    this.onMessage<TransformData>("updateTransform", (client, transform) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) {
        console.warn(`Unknown client: ${client.sessionId}`);
        return;
      }

      player.pos_x = transform.pos_x;
      player.pos_y = transform.pos_y;
      player.pos_z = transform.pos_z;
      player.rot_x = transform.rot_x;
      player.rot_y = transform.rot_y;
      player.rot_z = transform.rot_z;

      // all schema changes automatically sync to connected clients
    });

    // (optional) start your game loop at 60fps
    //this.setSimulationInterval((dt) => this.update(dt), 1000 / 60);
  }

  onJoin(client: Client, options: any, auth: any) {
    console.log(client.sessionId, "joined with options:", options, "auth:", auth);

    const player = new Player();
    player.nickname = options.nickname?.substring(0, 15) || "Guest";
    // initialize transform
    player.pos_x = player.pos_y = player.pos_z =
    player.rot_x = player.rot_y = player.rot_z = 0;

    this.state.players.set(client.sessionId, player);
    console.log(`→ spawned player ${client.sessionId} (${player.nickname})`);
  }

  onLeave(client: Client, consented: boolean) {
    console.log(client.sessionId, "left", consented ? "(consented)" : "(dropped)");
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log("Disposing room…");
  }
}

export default GameRoom;
