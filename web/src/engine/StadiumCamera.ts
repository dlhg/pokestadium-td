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
  private readonly maxDistance = 75;
  private readonly panSpeed = 20;
  private readonly arenaLimit = 22;

  // Screen shake
  private shakeIntensity: number = 0;
  private shakeOffset: THREE.Vector3 = new THREE.Vector3();

  // Action cam target
  private actionFocusTarget: THREE.Vector3 | null = null;
  private actionTimer: number = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.5,
      300
    );
    this.setMode('tactical');
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentTarget);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  public setMode(mode: CameraMode): void {
    this.mode = mode;
    switch (mode) {
      case 'tactical':
        this.desiredPos.set(0, 45, 26);
        this.desiredTarget.set(0, 0, 1);
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
    this.syncOrbitFromDesired();
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
      this.distance = THREE.MathUtils.clamp(
        this.distance * Math.exp(input.wheelDelta * 0.001),
        this.minDistance,
        this.maxDistance,
      );
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

  public shake(amount: number): void {
    this.shakeIntensity = Math.min(this.shakeIntensity + amount, 1.2);
  }

  public update(dt: number): void {
    // Handle action cam expiration
    if (this.actionTimer > 0) {
      this.actionTimer -= dt;
      if (this.actionTimer <= 0) {
        this.setMode(this.mode === 'action' ? 'stadium' : this.mode);
        this.actionFocusTarget = null;
      }
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
    const lerpSpeed = dt * 4.5;
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
