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
  public isDragging: boolean = false;
  public clicked: boolean = false;
  public clickedOnUI: boolean = false;
  public rightClicked: boolean = false;
  /** Movement accumulated while a camera drag is active. */
  public dragDelta: THREE.Vector2 = new THREE.Vector2();
  /** Wheel movement accumulated since the previous frame. */
  public wheelDelta: number = 0;
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private canvas: HTMLCanvasElement;
  private pointerDownScreen: THREE.Vector2 = new THREE.Vector2();
  private pointerStartedOnUI: boolean = false;

  // Keyboard state
  public keysJustPressed: Set<string> = new Set();
  private keysDown: Set<string> = new Set();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.initListeners();
  }

  private initListeners(): void {
    window.addEventListener('mousemove', (e) => {
      const previousX = this.mouseScreen.x;
      const previousY = this.mouseScreen.y;
      this.mouseScreen.set(e.clientX, e.clientY);
      this.mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;

      if (this.isMouseDown && !this.pointerStartedOnUI) {
        const moved = Math.hypot(e.clientX - this.pointerDownScreen.x, e.clientY - this.pointerDownScreen.y);
        if (moved > 5) this.isDragging = true;
        if (this.isDragging) {
          this.dragDelta.x += e.clientX - previousX;
          this.dragDelta.y += e.clientY - previousY;
        }
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.isMouseDown = true;
        this.isDragging = false;
        this.dragDelta.set(0, 0);
        this.pointerDownScreen.set(e.clientX, e.clientY);
        this.pointerStartedOnUI = e.target instanceof Element && e.target.closest('.interactive') !== null;
        this.clickedOnUI = this.pointerStartedOnUI;
      } else if (e.button === 2) {
        this.rightClicked = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isMouseDown = false;
        // A click is only emitted after release, so dragging never selects a tower.
        if (!this.isDragging) {
          this.clicked = true;
          this.clickedOnUI = this.pointerStartedOnUI;
        }
        this.isDragging = false;
      }
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheelDelta += e.deltaY;
    }, { passive: false });

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
        this.clickedOnUI = touch.target instanceof Element && touch.target.closest('.interactive') !== null;
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

  /** The pointer's ray into the world, for callers that test their own surfaces. */
  public pointerRay(camera: THREE.Camera): THREE.Ray {
    this.raycaster.setFromCamera(this.mouseNDC, camera);
    return this.raycaster.ray.clone();
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

  public isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  public update(): void {
    this.clicked = false;
    this.clickedOnUI = false;
    this.rightClicked = false;
    this.keysJustPressed.clear();
    this.dragDelta.set(0, 0);
    this.wheelDelta = 0;
  }
}
