import * as RE from 'rogue-engine';
import * as Colyseus from 'colyseus.js';
import * as THREE from 'three';

/**
 * Represents the networked state of a player's avatar.
 */
interface PlayerState {
  pos_x: number;
  pos_y: number;
  pos_z: number;
  rot_x: number; // Euler Angle X
  rot_y: number; // Euler Angle Y
  rot_z: number; // Euler Angle Z
  // You might also receive a timestamp from the server here
  // timestamp?: number;
}

/**
 * Stores runtime data for a remote avatar.
 */
interface RemoteAvatarData {
  object: THREE.Object3D;
  targetPosition: THREE.Vector3;
  targetRotationQuaternion: THREE.Quaternion;
  lastUpdateTime: number; // Local time when target was updated
}

@RE.registerComponent
export default class ColyseusRoomManager extends RE.Component {
  // --- Rogue Engine props ---
  @RE.props.text()
  serverAddress: string = 'ws://localhost:2567';

  @RE.props.text()
  roomName: string = 'game';

  @RE.props.text()
  avatarPath: string = 'Character/Dummy'; // Path to your avatar prefab

  @RE.props.num()
  // Interpolation speed: percentage of the remaining distance/angle to cover per second.
  // INCREASE THIS VALUE to make remote avatars catch up faster and appear smoother.
  // A value between 8 and 15 is often a good starting point for smoother movement.
  interpolationSpeed: number = 12; // Increased default value

  @RE.props.text()
  // Euler angle order for network serialization/deserialization. Must match sender (LocalTransformSync) and server.
  // Common orders: 'XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'
  eulerOrder: THREE.EulerOrder = 'XYZ'; // Ensure this matches LocalTransformSync

  @RE.props.vector3()
  // The default position where avatars will be spawned in the scene.
  // The position from the server state is used for interpolation targets after spawning.
  spawnPosition: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

  // --- Networking fields ---
  private client!: Colyseus.Client;
  private room!: Colyseus.Room<any>;
  private currentState: any = null;
  private collectionListenersAttached: boolean = false; // Flag to track if collection listeners are attached

  // --- Avatar management ---
  private remoteAvatars: Record<string, RemoteAvatarData> = {};

  // Temporary objects for interpolation calculations
  private tempQuaternion1 = new THREE.Quaternion();
  private tempQuaternion2 = new THREE.Quaternion();
  // Use Euler with specified order for consistency when converting to Quaternion
  private tempEuler = new THREE.Euler(0, 0, 0, this.eulerOrder);

  start() {
    console.log(`Connecting to Colyseus server at ${this.serverAddress}...`);
    this.client = new Colyseus.Client(this.serverAddress);
    // Ensure the temporary Euler object uses the configured order
    this.tempEuler.order = this.eulerOrder;
    this.joinRoom({ nickname: "Guest" });

    // Ensure cleanup if the engine stops
    RE.Runtime.onStop(() => this.onDestroy());
  }

  /**
   * Joins or creates the Colyseus room.
   */
  private async joinRoom(options: any) {
    try {
      this.room = await this.client.joinOrCreate(this.roomName, options);
      console.log('Joined room:', this.room.name, 'with sessionId:', this.room.sessionId);

      // Listen for full state updates (useful for initial sync and attaching collection listeners)
      this.room.onStateChange((state) => {
        this.currentState = state;
        // The initial state change handles spawning existing players and setting their initial targets
        this.syncAvatars(state.players);

        // --- Attach dynamic collection listeners if not already attached ---
        // We wait until the state is received and check if the players collection exists
        if (!this.collectionListenersAttached && state.players) {
             console.log("Attaching collection listeners.");
             state.players.onAdd = (player: PlayerState, sessionId: string) => {
                console.log(`Player ${sessionId} added.`);
                if (sessionId === this.room.sessionId) return; // Don't process local player

                // Spawn the avatar and immediately set its target to the initial state
                this.spawnAvatar(sessionId, player);
                // updateAvatarTarget will be called by onChange for subsequent updates
             };

             state.players.onRemove = (player: PlayerState, sessionId: string) => {
                console.log(`Player ${sessionId} removed.`);
                if (sessionId === this.room.sessionId) return; // Don't process local player
                this.destroyAvatar(sessionId);
             };

             state.players.onChange = (player: PlayerState, sessionId: string) => {
               // console.log(`Player ${sessionId} changed.`); // Can be noisy
               if (sessionId === this.room.sessionId) return; // Don't process local player
               // Update the interpolation target for the existing avatar
               this.updateAvatarTarget(sessionId, player);
             };

             this.collectionListenersAttached = true; // Set the flag so we don't attach them again
        }
        // --- End of dynamic collection listeners attachment ---
      });

      this.room.onError((code, message) => {
        console.error(`Room error [${code}]: ${message}`);
        // Reset state and room on error
        this.currentState = null;
        this.room = null as any;
        this.collectionListenersAttached = false; // Reset flag on error
        // Clean up avatars on error
        Object.keys(this.remoteAvatars).forEach(sid => this.destroyAvatar(sid));
      });

      this.room.onLeave((code) => {
        console.log('Left room with code', code);
        // Reset state and room on leave
        this.currentState = null;
        this.room = null as any;
        this.collectionListenersAttached = false; // Reset flag on leave
         // Clean up all remote avatars on leave
        Object.keys(this.remoteAvatars).forEach(sid => this.destroyAvatar(sid));
      });

    } catch (e) {
      console.error(`Could not join room "${this.roomName}":`, e);
      // Ensure state and room are null if joining fails
      this.currentState = null;
      this.room = null as any;
      this.collectionListenersAttached = false; // Reset flag if joining fails
    }
  }

  /**
   * Sends a custom message to the server.
   */
  public sendMessage(messageType: string, data?: any) {
    // Only send if connected to a room
    if (this.room) {
      this.room.send(messageType, data);
    } else {
      // This warning is expected if sendMessage is called before successful join
      // console.warn('Cannot send message, not connected to a room.'); // Commented out to reduce noise
    }
  }

  /**
   * Returns the last known state object.
   */
  public getCurrentState(): any | null {
    return this.currentState;
  }

  /**
   * Cleans up all avatars and leaves the room.
   */
  public onDestroy() {
    console.log('RoomManagerComponent onDestroy');
    // Leave the room when the component is destroyed
    if (this.room) {
      console.log('Leaving room...');
      // Passing true signals to the server that this is an intended leave
      this.room.leave(true);
    }

    // Remove and dispose every remote avatar
    Object.keys(this.remoteAvatars).forEach(sid => {
      this.destroyAvatar(sid);
    });

    // Reset state and room references
    this.currentState = null;
    this.room = null as any;
    this.remoteAvatars = {}; // Clear the map
    this.collectionListenersAttached = false; // Reset flag on destroy
  }

  /**
   * Main update loop: called every frame by Rogue Engine.
   * This is where we perform interpolation for remote avatars.
   */
  update() {
    // Only update if component is enabled
    if (!this.enabled) return;

    // Get the time elapsed since the last frame in seconds
    const deltaTime = RE.Runtime.deltaTime;

    // Iterate through all tracked remote avatars
    for (const sid in this.remoteAvatars) {
      const data = this.remoteAvatars[sid];
      const obj = data.object; // The THREE.Object3D representing the avatar

      // Calculate the interpolation factor based on time and speed.
      // This formula ensures smooth, frame-rate-independent interpolation.
      // It covers a percentage (interpolationSpeed) of the remaining distance/angle to cover per second.
      // Math.min(1, ...) prevents overshooting if deltaTime is very large (e.g., after a pause).
      const factor = 1.0 - Math.pow(1.0 - Math.min(1, this.interpolationSpeed), deltaTime);

      // --- Position interpolation ---
      // Linearly interpolate the object's current position towards the target position
      obj.position.lerp(data.targetPosition, factor);

      // --- Rotation interpolation ---
      // Get the object's current rotation as a quaternion
      this.tempQuaternion1.setFromEuler(obj.rotation);
      // The target rotation is already stored as a quaternion
      this.tempQuaternion2.copy(data.targetRotationQuaternion);
      // Spherical linearly interpolate (slerp) towards the target quaternion
      this.tempQuaternion1.slerp(this.tempQuaternion2, factor);
      // Apply the interpolated quaternion back to the object's rotation
      obj.setRotationFromQuaternion(this.tempQuaternion1);
    }
  }

  /**
   * Syncs spawn/despawn based on a full state update.
   * This is primarily used for the initial state received upon joining.
   * Subsequent changes are ideally handled by onAdd/onRemove/onChange once attached.
   */
  private syncAvatars(playersMap: any) {
    // Ensure we have a room and a players map
    if (!this.room || !playersMap) return;

    const localId = this.room.sessionId;
    const incomingIds: string[] = [];

    // Collect session IDs from the incoming state
    playersMap.forEach((state: PlayerState, sessionId: string) => {
      incomingIds.push(sessionId);
    });

    // --- Destroy avatars no longer in the incoming state ---
    // Iterate through our currently tracked remote avatars
    for (const sid of Object.keys(this.remoteAvatars)) {
      // If an avatar exists in our map but its ID is NOT in the incoming state IDs
      if (!incomingIds.includes(sid)) {
        // Destroy that avatar
        this.destroyAvatar(sid);
      }
    }

    // --- Spawn new avatars found in the incoming state ---
    // Iterate through the incoming session IDs
    for (const sid of incomingIds) {
      // Skip the local player's ID
      if (sid === localId) continue;
      // If an avatar for this ID does NOT exist in our remoteAvatars map
      if (!this.remoteAvatars[sid]) {
          const playerState = playersMap.get(sid);
          // If we have state for this new player
          if(playerState) {
              // Spawn the avatar. spawnAvatar also sets the initial target.
              this.spawnAvatar(sid, playerState);
          } else {
              console.warn(`State for new player ${sid} not found during sync.`);
          }
      }
    }

    // --- Update existing avatars ---
    // Iterate through the incoming state entries
    for (const [sessionId, state] of playersMap.entries()) {
      // Skip the local player
      if (sessionId === localId) continue;
      // If the avatar exists in our tracking map (it should if spawnAvatar succeeded)
      if (this.remoteAvatars[sessionId]) {
         // Update its interpolation target
         this.updateAvatarTarget(sessionId, state as PlayerState);
      }
    }
  }

  /**
   * Instantiates the avatar prefab, adds it to the scene, and initializes interpolation targets.
   */
  private async spawnAvatar(sessionId: string, initialState: PlayerState) {
    // Prevent double spawning if called multiple times for the same ID
    if (this.remoteAvatars[sessionId]) {
        console.warn(`Avatar for ${sessionId} already exists, skipping spawn.`);
        return;
    }

    try {
      // Fetch the avatar prefab asynchronously
      const prefab = await RE.Prefab.fetch(this.avatarPath);
      // Instantiate the prefab to create a new THREE.Object3D
      const avatar = prefab.instantiate();
      // Set a descriptive name for easier debugging
      avatar.name = `Avatar_${sessionId}`;

      // --- Set initial position and rotation ---
      // Use the configured spawn position from the component properties
      avatar.position.copy(this.spawnPosition);
      // Set the initial rotation using the received Euler angles and the configured order
      this.tempEuler.set(initialState.rot_x, initialState.rot_y, initialState.rot_z, this.eulerOrder);
      avatar.setRotationFromEuler(this.tempEuler);

      // --- Initialize interpolation targets ---
      // The target position is the initial position received from the server state
      const targetPosition = new THREE.Vector3(initialState.pos_x, initialState.pos_y, initialState.pos_z);
      // The target rotation is the initial rotation converted to a quaternion
      const targetRotationQuaternion = new THREE.Quaternion().setFromEuler(this.tempEuler);

      // Store the avatar object and its targets in our map
      this.remoteAvatars[sessionId] = {
        object: avatar,
        targetPosition: targetPosition,
        targetRotationQuaternion: targetRotationQuaternion,
        lastUpdateTime: performance.now(), // Record when this state was received/processed
      };

      console.log(`Spawned avatar for ${sessionId} at ${this.spawnPosition.x}, ${this.spawnPosition.y}, ${this.spawnPosition.z}`);
    } catch (error) {
      // Log an error if prefab fetching or instantiation fails
      console.error(`Failed to spawn avatar for ${sessionId}:`, error);
    }
  }

  /**
   * Updates the lerp/slerp target values for an avatar based on a new state update.
   */
  private updateAvatarTarget(sessionId: string, st: PlayerState) {
    // Get the data entry for the avatar from our map
    const data = this.remoteAvatars[sessionId];
    // If the avatar data doesn't exist (e.g., spawnAvatar hasn't finished yet or avatar was already destroyed)
    if (!data) {
        // Log a warning and exit
        console.warn(`Received state update for unknown avatar ${sessionId}.`);
        return;
    }

    // --- Update target position and rotation ---
    // Set the target position to the new position from the state
    data.targetPosition.set(st.pos_x, st.pos_y, st.pos_z);
    // Convert the new Euler angles from the state to a quaternion using the configured order
    this.tempEuler.set(st.rot_x, st.rot_y, st.rot_z, this.eulerOrder);
    data.targetRotationQuaternion.setFromEuler(this.tempEuler);
    // Record the time this target update occurred
    data.lastUpdateTime = performance.now(); // Or use a timestamp from the state if available
  }

  /**
   * Removes an avatar by sessionId, detaches it from the scene, and disposes its resources.
   */
  private destroyAvatar(sessionId: string) {
    // Get the data entry for the avatar
    const data = this.remoteAvatars[sessionId];
    // If the avatar data doesn't exist, it's already destroyed or wasn't tracked
    if (!data) {
        console.warn(`Attempted to destroy unknown avatar ${sessionId}.`);
        return;
    }

    const obj = data.object; // The THREE.Object3D to destroy

    // --- Remove the object from its parent in the scene graph ---
    if (obj.parent) {
        obj.parent.remove(obj);
    } else {
        // This might happen if the object was never added to the scene correctly,
        // or if its parent was removed first.
        console.warn(`Avatar object for ${sessionId} has no parent, cannot remove from scene.`);
    }

    // --- Dispose geometry, materials, textures recursively ---
    // This is important to prevent memory leaks in Three.js
    this.disposeHierarchy(obj);

    // --- Clean up tracking ---
    // Remove the avatar entry from our map
    delete this.remoteAvatars[sessionId];
    console.log(`Destroyed avatar for ${sessionId}`);

    // Note: The removeObjectsByName method is generally less efficient than
    // directly removing/disposing the known object reference via destroyAvatar.
    // It's kept below as a potential fallback but might not be necessary
    // if destroyAvatar is reliably called when players leave.
    // this.removeObjectsByName(`Avatar_${sessionId}`);
  }

  /**
   * Walks the entire scene graph, finds objects matching name,
   * removes and disposes them entirely. Use with caution, can be slow.
   */
  private removeObjectsByName(name: string) {
    const scene = RE.Runtime.scene as THREE.Scene;
    const objectsToRemove: THREE.Object3D[] = [];

    // Collect objects to remove (cannot modify children during traverse)
    scene.traverse(obj => {
      if (obj.name === name) {
        objectsToRemove.push(obj);
      }
    });

    // Remove and dispose collected objects
    objectsToRemove.forEach(obj => {
        if (obj.parent) obj.parent.remove(obj);
        this.disposeHierarchy(obj);
    });
  }

  /**
   * Recursively disposes geometry, materials, and textures within a THREE.Object3D hierarchy.
   * Helps prevent memory leaks.
   */
  private disposeHierarchy(node: THREE.Object3D) {
    // Traverse children first for proper disposal order
     const children = node.children.slice(); // Clone array as we might remove children during traversal
     children.forEach(child => this.disposeHierarchy(child));

    // Dispose Geometry if it exists and has a dispose method
    const mesh = node as THREE.Mesh;
    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') {
      mesh.geometry.dispose();
       // console.log(`Disposed geometry for ${node.name}`);
    }

    // Dispose Materials and their associated Textures if they exist
    if (mesh.material) {
        const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];

        materials.filter(Boolean).forEach(mat => mat && this.disposeMaterial(mat));
    }

    // Note: Object3D itself doesn't typically need explicit 'dispose' unless
    // it holds other disposable resources not covered above (e.g., RenderTargets).
  }

  /**
   * Disposes a material and any associated textures.
   */
  private disposeMaterial(mat: THREE.Material) {
    // Dispose textures on the material by iterating through its properties
    Object.values(mat).forEach(value => {
      // Check if the value is a THREE.Texture and has a dispose method
      if (value instanceof THREE.Texture && typeof value.dispose === 'function') {
        value.dispose();
         // console.log(`Disposed texture on material for ${mat.name || 'Unnamed Material'}`);
      }
    });
    // Dispose the material itself if it has a dispose method
     if (typeof mat.dispose === 'function') {
        mat.dispose();
         // console.log(`Disposed material ${mat.name || 'Unnamed Material'}`);
     }
  }
}