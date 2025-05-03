import { Schema, type, MapSchema } from "@colyseus/schema";

class Player extends Schema {
  // Transform
  @type("number") public pos_x: number = 0;
  @type("number") public pos_y: number = 0;
  @type("number") public pos_z: number = 0;
  @type("number") public rot_x: number = 0;
  @type("number") public rot_y: number = 0;
  @type("number") public rot_z: number = 0;

  // World Sync
  @type("string") public prefabModel: "Character/Dummy";  //Character Model-Prefab Path Name
  @type("string") public animationState: "idle";  //Animation state (idle, walk, run, etc)
  @type("string") public nickname: "Guest";
  //@type("boolean") public isAlive: true;
  //@type("string") public status: "idle"; // e.g., "playing", " Spectating", " loading"
  //@type("string") public currentZone: "";

  // Stats
  @type("number") public money: 0;
  //@type("number") public health: 100;
  //@type("number") public maxHealth: 100;
  //@type("number") public speed: 5;
  //@type("number") public attackPower: 10;
  //@type("number") public level: 1;
  //@type("number") public experience: 0;

  //@type({ map: "number" }) public inventory = new MapSchema<number>(); // Map of item ID to quantity
  // Or for more complex items:
  // @type({ map: Item }) public inventory = new MapSchema<Item>(); // Wh

  //@type("string") public teamId: string = ""; // Or a number for team index

  //@type("string") public hatId: string = "";
  //@type("string") public skinId: string = "";


}

class State extends Schema {
  @type({ map: Player }) public players = new MapSchema<Player>();
}

export {
  Player,
  State
};