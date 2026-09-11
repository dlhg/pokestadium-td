/**
 * StadiumCamera.ts — Dynamic Multi-Angle Stadium Camera Controller
 *
 * Implements smooth cinematic transitions between:
 * 1. Tactical TD View (top-down view for tower placement)
 * 2. Stadium Isometric View (classic colosseum broadcast angle)
 * 3. Dynamic Action Cam (dramatic low-angle close-up during intense attacks)
 */

import * as THREE from 'three';

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
    this.shake(0.35);
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
}
