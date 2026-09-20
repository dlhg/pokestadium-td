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
  private activeTouchId: number | null = null;

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

    // Touch mirrors the mouse gesture: movement drags the camera, while only a
    // release that stayed within the click threshold can select something.
    window.addEventListener('touchstart', (e) => {
      if (this.activeTouchId !== null || e.changedTouches.length === 0) return;
      const touch = e.changedTouches[0];
      this.activeTouchId = touch.identifier;
      this.updatePointer(touch.clientX, touch.clientY);
      this.isMouseDown = true;
      this.isDragging = false;
      this.dragDelta.set(0, 0);
      this.pointerDownScreen.set(touch.clientX, touch.clientY);
      this.pointerStartedOnUI = touch.target instanceof Element && touch.target.closest('.interactive') !== null;
      this.clickedOnUI = this.pointerStartedOnUI;
      if (!this.pointerStartedOnUI) e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      const touch = this.activeTouch(e.touches);
      if (!touch) return;
      const previousX = this.mouseScreen.x;
      const previousY = this.mouseScreen.y;
      this.updatePointer(touch.clientX, touch.clientY);
      if (!this.pointerStartedOnUI) {
        const moved = Math.hypot(touch.clientX - this.pointerDownScreen.x, touch.clientY - this.pointerDownScreen.y);
        if (moved > 5) this.isDragging = true;
        if (this.isDragging) {
          this.dragDelta.x += touch.clientX - previousX;
          this.dragDelta.y += touch.clientY - previousY;
        }
        e.preventDefault();
      }
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
      const touch = this.activeTouch(e.changedTouches);
      if (!touch) return;
      this.updatePointer(touch.clientX, touch.clientY);
      if (!this.isDragging) {
        this.clicked = true;
        this.clickedOnUI = this.pointerStartedOnUI;
      }
      if (!this.pointerStartedOnUI) e.preventDefault();
      this.finishPointerGesture();
    }, { passive: false });

    window.addEventListener('touchcancel', (e) => {
      if (this.activeTouch(e.changedTouches)) this.finishPointerGesture();
    });

    // Keyboard
    window.addEventListener('keydown', (e) => {
      // Typing a nickname must not pause the match or swing the camera.
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return;
      if (!this.keysDown.has(e.code)) {
        this.keysJustPressed.add(e.code);
        this.keysDown.add(e.code);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
    });

    // Browsers do not dispatch keyup/mouseup for every gesture when focus
    // leaves the tab (for example, Cmd-Tab while holding W).
    window.addEventListener('blur', () => this.resetHeldInput());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.resetHeldInput();
    });
  }

  private updatePointer(x: number, y: number): void {
    this.mouseScreen.set(x, y);
    this.mouseNDC.x = (x / window.innerWidth) * 2 - 1;
    this.mouseNDC.y = -(y / window.innerHeight) * 2 + 1;
  }

  private activeTouch(list: TouchList): Touch | null {
    if (this.activeTouchId === null) return null;
    for (let i = 0; i < list.length; i++) {
      if (list[i].identifier === this.activeTouchId) return list[i];
    }
    return null;
  }

  private finishPointerGesture(): void {
    this.isMouseDown = false;
    this.isDragging = false;
    this.activeTouchId = null;
  }

  private resetHeldInput(): void {
    this.keysDown.clear();
    this.keysJustPressed.clear();
    this.clicked = false;
    this.rightClicked = false;
    this.dragDelta.set(0, 0);
    this.finishPointerGesture();
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
