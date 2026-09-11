/**
 * Input.ts — 3D Raycasting and Pointer Management
 *
 * Handles mouse/touch tracking, 3D raycasting against stadium pedestals,
 * tower selection, and keyboard shortcuts.
 */

import * as THREE from 'three';

export interface RaycastResult {
  point: THREE.Vector3;
  object: THREE.Object3D | null;
}

export class Input {
  public mouseNDC: THREE.Vector2 = new THREE.Vector2(-999, -999);
  public mouseScreen: THREE.Vector2 = new THREE.Vector2(0, 0);
  public isMouseDown: boolean = false;
  public clicked: boolean = false;
  public rightClicked: boolean = false;
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private canvas: HTMLCanvasElement;

  // Keyboard state
  public keysJustPressed: Set<string> = new Set();
  private keysDown: Set<string> = new Set();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.initListeners();
  }

  private initListeners(): void {
    window.addEventListener('mousemove', (e) => {
      this.mouseScreen.set(e.clientX, e.clientY);
      this.mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.isMouseDown = true;
        this.clicked = true;
      } else if (e.button === 2) {
        this.rightClicked = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isMouseDown = false;
      }
    });

    window.addEventListener('contextmenu', (e) => {
      // Prevent default right-click context menu so it can cancel selection
      e.preventDefault();
    });

    // Touch support
    window.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        this.mouseScreen.set(touch.clientX, touch.clientY);
        this.mouseNDC.x = (touch.clientX / window.innerWidth) * 2 - 1;
        this.mouseNDC.y = -(touch.clientY / window.innerHeight) * 2 + 1;
        this.clicked = true;
      }
    }, { passive: false });

    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (!this.keysDown.has(e.code)) {
        this.keysJustPressed.add(e.code);
        this.keysDown.add(e.code);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
    });
  }

  public raycast(camera: THREE.Camera, objects: THREE.Object3D[]): THREE.Intersection[] {
    this.raycaster.setFromCamera(this.mouseNDC, camera);
    return this.raycaster.intersectObjects(objects, true);
  }

  public raycastGround(camera: THREE.Camera, groundY: number = 0): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.mouseNDC, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);
    const target = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, target);
  }

  public isKeyJustPressed(code: string): boolean {
    return this.keysJustPressed.has(code);
  }

  public update(): void {
    this.clicked = false;
    this.rightClicked = false;
    this.keysJustPressed.clear();
  }
}
