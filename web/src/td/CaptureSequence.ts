/** A small, original Stadium-style Poké Ball presentation for capture attempts. */
import * as THREE from 'three';
import { Creep } from './Creep';

export type BallType = 'poke' | 'great' | 'ultra';

const BALL_COLORS: Record<BallType, [number, number]> = {
  poke: [0xd90429, 0xffffff],
  great: [0x2468c7, 0xf14b3e],
  ultra: [0x1b1b20, 0xf3c532],
};

export class CaptureSequence {
  public readonly group = new THREE.Group();
  private ball: THREE.Group;
  private flash: THREE.Mesh;
  private elapsed = 0;
  private readonly duration: number;
  private readonly success: boolean;

  constructor(private target: Creep, ballType: BallType, chance: number) {
    this.success = Math.random() < chance;
    this.duration = this.success ? 2.9 : 3.25;
    this.ball = this.createBall(ballType);
    this.ball.position.set(-10, 4, -8);
    this.group.add(this.ball);

    this.flash = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.32, 24),
      new THREE.MeshBasicMaterial({ color: 0xdffcff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.flash.rotation.x = -Math.PI / 2;
    this.flash.position.copy(target.position);
    this.flash.position.y += 0.05;
    this.group.add(this.flash);
  }

  /** Returns a result only after the full throw, absorb, and shake sequence. */
  public update(dt: number): boolean | null {
    this.elapsed += dt;
    const targetPos = this.target.position.clone();
    const t = this.elapsed;
    if (t < 0.55) {
      const p = t / 0.55;
      this.ball.position.lerpVectors(new THREE.Vector3(-10, 4, -8), targetPos.clone().add(new THREE.Vector3(0, 1.2, 0)), p);
      this.ball.position.y += Math.sin(p * Math.PI) * 4;
      this.ball.rotation.z += dt * 18;
    } else if (t < 1.05) {
      const p = (t - 0.55) / 0.5;
      this.ball.position.copy(targetPos).add(new THREE.Vector3(0, 0.25 + (1 - p) * 0.95, 0));
      (this.flash.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - p);
      this.flash.scale.setScalar(1 + p * 8);
      this.target.group.scale.setScalar(Math.max(0.04, 1 - p));
      this.target.group.visible = p < 0.92;
    } else if (t < 2.75) {
      const shake = Math.sin((t - 1.05) * 10) * Math.max(0, 0.26 - (t - 1.05) * 0.12);
      this.ball.position.copy(targetPos).add(new THREE.Vector3(shake, 0.24, 0));
      this.ball.rotation.z = shake * 2.5;
    } else if (this.success) {
      const p = Math.min(1, (t - 2.75) / 0.15);
      (this.flash.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - p);
      this.flash.scale.setScalar(5 + p * 4);
    }
    return t >= this.duration ? this.success : null;
  }

  public dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach(m => m.dispose()); else material.dispose();
      }
    });
  }

  private createBall(type: BallType): THREE.Group {
    const [top, bottom] = BALL_COLORS[type];
    const root = new THREE.Group();
    const topHalf = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: top, roughness: 0.35, metalness: 0.25 }));
    topHalf.rotation.x = Math.PI;
    const bottomHalf = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: bottom, roughness: 0.35, metalness: 0.25 }));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 6, 16), new THREE.MeshBasicMaterial({ color: 0x151922 }));
    band.rotation.x = Math.PI / 2;
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    button.position.z = 0.32;
    root.add(topHalf, bottomHalf, band, button);
    return root;
  }
}
