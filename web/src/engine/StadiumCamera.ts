/**
 * StadiumCamera.ts — Dynamic Multi-Angle Stadium Camera Controller
 *
 * Implements smooth cinematic transitions between:
 * 1. Tactical TD View (top-down view for tower placement)
 * 2. Stadium Isometric View (classic colosseum broadcast angle)
 * 3. Dynamic Action Cam (dramatic low-angle close-up during intense attacks)
 */

import * as THREE from 'three';
import { Input } from './Input';

export type CameraMode = 'tactical' | 'stadium' | 'action';

export class StadiumCamera {
  public camera: THREE.PerspectiveCamera;
  public mode: CameraMode = 'tactical';

  // Current position and target
  private currentPos: THREE.Vector3 = new THREE.Vector3(0, 42, 28);
  private currentTarget: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

  // Target presets
  private desiredPos: THREE.Vector3 = new THREE.Vector3(0, 42, 28);
  private desiredTarget: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

  // Player-controlled orbit state around desiredTarget.
  private yaw: number = 0;
  private pitch: number = Math.PI / 3;
  private distance: number = 40;
  private readonly minPitch = THREE.MathUtils.degToRad(20);
  private readonly maxPitch = THREE.MathUtils.degToRad(80);
  private readonly minDistance = 12;
  private readonly maxDistance = 110;
  private readonly panSpeed = 20;
  private readonly arenaLimit = 22;

  // Screen shake
  private shakeIntensity: number = 0;
  private shakeOffset: THREE.Vector3 = new THREE.Vector3();

  // Action cam target
  private actionFocusTarget: THREE.Vector3 | null = null;
  private actionTimer: number = 0;
  private actionSubjectId: string | null = null;
  private actionTrackingReady: boolean = false;
  private actionFollowFocus: THREE.Vector3 = new THREE.Vector3();
  private actionFollowGoal: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private actionOrbitAngle: number = Math.PI * 0.25;
  private actionDistance: number = 13.5;
  private actionHandoffTimer: number = 0;
  private actionHandoffDirection: number = 1;

  // Held cinematic shot (capture set piece): owns the camera until released.
  private cinematic: {
    focus: THREE.Vector3;
    distance: number;
    height: number;
    orbitSpeed: number;
    angle: number;
    targetYOffset: number;
    restore: { pos: THREE.Vector3; target: THREE.Vector3 };
  } | null = null;
  private readonly baseFov = 45;
  private fovOffset: number = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.5,
      300
    );
    this.setMode('tactical');
    this.currentPos.copy(this.desiredPos);
    this.currentTarget.copy(this.desiredTarget);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentTarget);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  public setMode(mode: CameraMode): void {
    this.mode = mode;
    this.actionTimer = 0;
    this.actionFocusTarget = null;
    this.actionSubjectId = null;
    this.actionTrackingReady = false;
    this.applyModePreset();
    this.syncOrbitFromDesired();
  }

  private applyModePreset(): void {
    const mode = this.mode;
    switch (mode) {
      case 'tactical':
        this.desiredPos.set(4, 82, 42);
        this.desiredTarget.set(4, 0, 0);
        break;
      case 'stadium':
        this.desiredPos.set(-26, 26, 30);
        this.desiredTarget.set(0, 2, 0);
        break;
      case 'action':
        this.desiredPos.set(16, 12, 16);
        this.desiredTarget.set(0, 1, 0);
        break;
    }
  }

  /**
   * Supplies the live leader for Action mode. Subject changes deliberately
   * retain the previous focus and viewing angle so a knockout becomes a
   * camera move, rather than a cut across the arena.
   */
  public setActionTarget(subjectId: string | null, position: THREE.Vector3 | null): void {
    const nextGoal = position ?? new THREE.Vector3(0, 1, 0);
    if (!this.actionTrackingReady) {
      this.actionFollowFocus.copy(this.currentTarget);
      this.actionOrbitAngle = Math.atan2(
        this.currentPos.x - this.currentTarget.x,
        this.currentPos.z - this.currentTarget.z,
      );
      this.actionTrackingReady = true;
    }

    if (subjectId !== this.actionSubjectId) {
      const toNext = nextGoal.clone().sub(this.actionFollowFocus);
      const cameraSide = this.currentPos.clone().sub(this.actionFollowFocus);
      const cross = cameraSide.x * toNext.z - cameraSide.z * toNext.x;
      this.actionHandoffDirection = cross < 0 ? -1 : 1;
      this.actionHandoffTimer = 1.5;
      this.actionSubjectId = subjectId;
    }
    this.actionFollowGoal.copy(nextGoal);
  }

  public triggerActionCam(focusPos: THREE.Vector3, duration: number = 2.0): void {
    this.actionFocusTarget = focusPos.clone();
    this.actionTimer = duration;

    // Choose an action camera offset that looks toward the focus position
    const offsetAngle = Math.random() * Math.PI * 2;
    const dist = 12 + Math.random() * 4;
    this.desiredPos.set(
      focusPos.x + Math.cos(offsetAngle) * dist,
      focusPos.y + 5 + Math.random() * 3,
      focusPos.z + Math.sin(offsetAngle) * dist
    );
    this.desiredTarget.copy(focusPos);
    this.syncOrbitFromDesired();
    this.shake(0.35);
  }

  /** Moves the focal point, zooms, and orbits without bypassing camera smoothing. */
  public handleInput(input: Input, dt: number): void {
    // A held cinematic set piece owns the camera; player input resumes after it.
    if (this.cinematic) return;
    const forwardPressed = input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp');
    const backPressed = input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown');
    const leftPressed = input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft');
    const rightPressed = input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight');
    const isPanning = forwardPressed || backPressed || leftPressed || rightPressed;

    const hasDragMovement = input.dragDelta.lengthSq() > 0;
    if (!hasDragMovement && input.wheelDelta === 0 && !isPanning) return;

    // Manual input deliberately exits a transient combat close-up.
    this.actionTimer = 0;
    this.actionFocusTarget = null;

    if (hasDragMovement) {
      this.yaw -= input.dragDelta.x * 0.008;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch + input.dragDelta.y * 0.006,
        this.minPitch,
        this.maxPitch,
      );
    }

    if (input.wheelDelta !== 0) {
      if (this.mode === 'action') {
        this.actionDistance = THREE.MathUtils.clamp(
          this.actionDistance * Math.exp(input.wheelDelta * 0.001),
          7.5,
          this.maxDistance,
        );
      } else {
        this.distance = THREE.MathUtils.clamp(
          this.distance * Math.exp(input.wheelDelta * 0.001),
          this.minDistance,
          this.maxDistance,
        );
      }
    }

    const forwardAmount = Number(forwardPressed) - Number(backPressed);
    const rightAmount = Number(rightPressed) - Number(leftPressed);
    if (forwardAmount !== 0 || rightAmount !== 0) {
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const movement = forward.multiplyScalar(forwardAmount).addScaledVector(right, rightAmount);
      movement.normalize().multiplyScalar(this.panSpeed * dt);
      this.desiredTarget.add(movement);
      this.desiredTarget.x = THREE.MathUtils.clamp(this.desiredTarget.x, -this.arenaLimit, this.arenaLimit);
      this.desiredTarget.z = THREE.MathUtils.clamp(this.desiredTarget.z, -this.arenaLimit, this.arenaLimit);
    }

    this.updateDesiredPositionFromOrbit();
  }

  /**
   * Takes the camera for a set piece: a low, close, slowly orbiting hero shot
   * on `focus` that ignores player input until releaseCinematic() restores the
   * framing the player had before.
   */
  public beginCinematic(
    focus: THREE.Vector3,
    distance: number = 9,
    height: number = 3.4,
    orbitSpeed: number = 0.32,
    startAngle?: number,
    targetYOffset: number = 0.9,
  ): void {
    this.actionTimer = 0;
    this.actionFocusTarget = null;
    this.cinematic = {
      focus: focus.clone(),
      distance,
      height,
      orbitSpeed,
      // Default to swinging in from behind the player's current viewing angle;
      // a caller that knows where the clear ground is can override it.
      angle: startAngle ?? Math.atan2(this.currentPos.x - focus.x, this.currentPos.z - focus.z) - 0.5,
      targetYOffset,
      restore: { pos: this.desiredPos.clone(), target: this.desiredTarget.clone() },
    };
  }

  /** Re-frames a live cinematic without restarting its orbit. */
  public setCinematicFraming(distance: number, height: number): void {
    if (!this.cinematic) return;
    this.cinematic.distance = distance;
    this.cinematic.height = height;
  }

  /** Turns a live cinematic onto an exact subject angle and optionally holds it there. */
  public setCinematicAngle(angle: number, orbitSpeed: number = 0): void {
    if (!this.cinematic) return;
    this.cinematic.angle = angle;
    this.cinematic.orbitSpeed = orbitSpeed;
  }

  /** Resolves the actual camera position for a cinematic angle, including the bowl clamp. */
  public cinematicPositionAt(
    focus: THREE.Vector3,
    distance: number,
    height: number,
    angle: number,
    result: THREE.Vector3 = new THREE.Vector3(),
  ): THREE.Vector3 {
    result.set(
      focus.x + Math.sin(angle) * distance,
      focus.y + height,
      focus.z + Math.cos(angle) * distance,
    );
    const reach = Math.hypot(result.x, result.z);
    if (reach > this.arenaLimit) {
      const pullIn = this.arenaLimit / reach;
      result.x *= pullIn;
      result.z *= pullIn;
      result.y += height * 0.35;
    }
    return result;
  }

  public releaseCinematic(): void {
    if (!this.cinematic) return;
    this.desiredPos.copy(this.cinematic.restore.pos);
    this.desiredTarget.copy(this.cinematic.restore.target);
    this.cinematic = null;
    this.syncOrbitFromDesired();
  }

  /** Snap zoom that decays back to the resting field of view. */
  public punchZoom(amount: number): void {
    this.fovOffset = Math.min(this.fovOffset + amount, 18);
  }

  public shake(amount: number): void {
    this.shakeIntensity = Math.min(this.shakeIntensity + amount, 1.2);
  }

  public update(dt: number): void {
    if (this.cinematic) {
      const shot = this.cinematic;
      shot.angle += shot.orbitSpeed * dt;
      // The orbit must stay inside the bowl: a set piece near the rim would
      // otherwise swing the camera into the grandstands and clip through them.
      this.cinematicPositionAt(shot.focus, shot.distance, shot.height, shot.angle, this.desiredPos);
      this.desiredTarget.copy(shot.focus).add(new THREE.Vector3(0, shot.targetYOffset, 0));
    }

    // Field-of-view punch decays back to rest.
    if (this.fovOffset !== 0) {
      this.fovOffset = Math.max(0, this.fovOffset - dt * 24);
      this.camera.fov = this.baseFov - this.fovOffset;
      this.camera.updateProjectionMatrix();
    }

    // Handle action cam expiration
    if (this.actionTimer > 0) {
      this.actionTimer -= dt;
      if (this.actionTimer <= 0) {
        this.actionFocusTarget = null;
        this.applyModePreset();
        if (this.mode === 'action') this.actionHandoffTimer = Math.max(this.actionHandoffTimer, 0.9);
        else this.syncOrbitFromDesired();
      }
    }

    if (this.mode === 'action' && !this.cinematic && this.actionTimer <= 0 && this.actionTrackingReady) {
      const handingOff = this.actionHandoffTimer > 0;
      const focusRate = handingOff ? 1.65 : 5.5;
      const focusBlend = 1 - Math.exp(-focusRate * dt);
      this.actionFollowFocus.lerp(this.actionFollowGoal, focusBlend);

      // A modest lateral sweep sells a target handoff as an authored camera
      // move while preserving the side of the action the player was viewing.
      if (handingOff) {
        this.actionOrbitAngle += this.actionHandoffDirection * 0.42 * dt;
        this.actionHandoffTimer = Math.max(0, this.actionHandoffTimer - dt);
      } else {
        this.actionOrbitAngle += 0.055 * dt;
      }
      const actionHeight = 3.5 + this.actionDistance * 0.17;
      this.cinematicPositionAt(
        this.actionFollowFocus,
        this.actionDistance,
        actionHeight,
        this.actionOrbitAngle,
        this.desiredPos,
      );
      this.desiredTarget.copy(this.actionFollowFocus).add(new THREE.Vector3(0, 1.35, 0));
    }

    // Screen shake decay
    if (this.shakeIntensity > 0) {
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 2.5);
      const s = this.shakeIntensity * 0.7;
      this.shakeOffset.set(
        (Math.random() - 0.5) * s,
        (Math.random() - 0.5) * s,
        (Math.random() - 0.5) * s
      );
    } else {
      this.shakeOffset.set(0, 0, 0);
    }

    // Smooth camera lerp (spring-like damping)
    const cameraRate = this.cinematic ? 3.0 : this.mode === 'action' ? 3.25 : 4.5;
    const lerpSpeed = 1 - Math.exp(-cameraRate * dt);
    this.currentPos.lerp(this.desiredPos, lerpSpeed);
    this.currentTarget.lerp(this.desiredTarget, lerpSpeed);

    this.camera.position.copy(this.currentPos).add(this.shakeOffset);
    this.camera.lookAt(this.currentTarget);
  }

  private syncOrbitFromDesired(): void {
    const offset = this.desiredPos.clone().sub(this.desiredTarget);
    this.distance = THREE.MathUtils.clamp(offset.length(), this.minDistance, this.maxDistance);
    this.yaw = Math.atan2(offset.x, offset.z);
    this.pitch = THREE.MathUtils.clamp(
      Math.asin(offset.y / this.distance),
      this.minPitch,
      this.maxPitch,
    );
  }

  private updateDesiredPositionFromOrbit(): void {
    const horizontalDistance = Math.cos(this.pitch) * this.distance;
    this.desiredPos.set(
      Math.sin(this.yaw) * horizontalDistance,
      Math.sin(this.pitch) * this.distance,
      Math.cos(this.yaw) * horizontalDistance,
    ).add(this.desiredTarget);
  }
}
