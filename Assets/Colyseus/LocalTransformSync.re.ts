import * as RE from 'rogue-engine';
import * as THREE from 'three';
import ColyseusRoomManager from './ColyseusRoomManager.re';

@RE.registerComponent
export default class LocalTransformSync extends RE.Component {
  private roomManager!: ColyseusRoomManager;
  private lastPosition = new THREE.Vector3();
  // Use Euler with a defined order for consistency
  // Initialize with a default order, will be updated from RoomManager
  private lastRotation = new THREE.Euler(0, 0, 0, 'XYZ');
  private positionTolerance = 0.001;
  private rotationTolerance = 0.001; // Tolerance for rotation angle difference (in radians)
  private updateInterval = 50; // Milliseconds
  private lastSendTime = 0;

  start() {
    this.roomManager = RE.getComponent(ColyseusRoomManager)!;
    if (!this.roomManager) {
      console.error('LocalTransformSync requires a ColyseusRoomManager');
      this.enabled = false;
      return;
    }

    if (this.object3d) {
      // Ensure the lastRotation Euler object uses the same order as the RoomManager
      // The object's rotation itself might have a different order initially depending on
      // how it was created or manipulated before this component starts.
      // We primarily care that the `lastRotation` *we track* uses the correct order
      // when comparing against the current object rotation.
      this.lastRotation.order = this.roomManager.eulerOrder;

      // Initialize last position and rotation
      this.lastPosition.copy(this.object3d.position);

      // When copying the object's current rotation, also ensure our tracked
      // lastRotation maintains the correct target order.
      this.lastRotation.copy(this.object3d.rotation); // Copies values and original order
      this.lastRotation.order = this.roomManager.eulerOrder; // Force our desired order for tracking
    } else {
      console.error('LocalTransformSync must be attached to a THREE.Object3D');
      this.enabled = false;
    }

    // No need to remove the object here in onDestroy/onStop
    // RE.Runtime.onStop(() => {
    //   // this.object3d.remove(); // This might remove the player's own avatar from the scene
    // });
  }

  update() {
    if (!this.enabled || !this.object3d || !this.roomManager.getCurrentState()) return; // Wait for state to be available

    const now = performance.now();

    // Only send updates if enough time has passed and transform has changed
    if (now - this.lastSendTime >= this.updateInterval) {
      const pos = this.object3d.position;
      const rot = this.object3d.rotation; // This is a THREE.Euler object

      let moved = false;

      // Check position difference
      if (this.lastPosition.distanceToSquared(pos) > this.positionTolerance ** 2) {
        moved = true;
        this.lastPosition.copy(pos);
      }

      // Check rotation difference using Quaternion angle difference (more robust than Euler component check)
      // Create quaternions *from* the Euler objects. setFromEuler uses the order of the Euler object.
      const currentQuaternion = new THREE.Quaternion().setFromEuler(rot); // Correct: uses rot.order
      const lastQuaternion = new THREE.Quaternion().setFromEuler(this.lastRotation); // Correct: uses this.lastRotation.order
      const angleDifference = currentQuaternion.angleTo(lastQuaternion);

      // Compare angle difference against tolerance
      if (angleDifference > this.rotationTolerance) {
         moved = true;
         // Update lastRotation using the current rotation values, ensuring order is kept
         this.lastRotation.copy(rot); // Copies values and original order from object3d.rotation
         this.lastRotation.order = this.roomManager.eulerOrder; // Force our desired order for tracking/comparison
      }

      // Optional: Also trigger an update if only Euler components changed significantly
      // even if the quaternion angle is small, to potentially catch subtle axis changes
      // that might matter depending on your game's needs. This is less critical than
      // the angle difference check for overall orientation.
      // const rotChanged =
      //   Math.abs(this.lastRotation.x - rot.x) > this.rotationTolerance ||
      //   Math.abs(this.lastRotation.y - rot.y) > this.rotationTolerance ||
      //   Math.abs(this.lastRotation.z - rot.z) > this.rotationTolerance;
      // if (rotChanged && angleDifference <= this.rotationTolerance) {
      //     moved = true;
      //     this.lastRotation.copy(rot);
      //     this.lastRotation.order = this.roomManager.eulerOrder;
      // }


      if (moved) {
        // Send current position and rotation (as Euler angles)
        // The receiver (ColyseusRoomManager) will need to interpret these
        // using the *same* Euler order ('XYZ' by default, or whatever is set).
        this.roomManager.sendMessage('updateTransform', {
          pos_x: pos.x, pos_y: pos.y, pos_z: pos.z,
          rot_x: rot.x, rot_y: rot.y, rot_z: rot.z, // Sending the Euler components directly
        });
        this.lastSendTime = now;
      }
    }

    // Remote avatar interpolation is now handled by ColyseusRoomManager.update()
    // this.roomManager.updateRemoteAvatars();
  }

}