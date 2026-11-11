// Saving must wait for ELK/X6 to finish instead of snapshotting a cleared canvas.
let pending: Promise<void> = Promise.resolve()
export function trackCanvasRender(operation: Promise<void>): void {
  pending = operation
  void operation.catch(() => {}) // The save UI reports errors when it awaits this render.
}
export async function waitForCanvasRender(): Promise<void> {
  let current: Promise<void>
  do { current = pending; await current } while (current !== pending)
}
