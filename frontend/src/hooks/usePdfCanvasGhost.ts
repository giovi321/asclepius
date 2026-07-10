import { useCallback, useRef, type RefObject } from "react";

/**
 * Flash-free zoom for the react-pdf viewers.
 *
 * react-pdf unmounts its canvas whenever the scale/width prop changes and
 * shows the loading node until the new render completes — on screen that
 * reads as the document blinking out to the container background on every
 * zoom step, which makes pinch zooming feel broken.
 *
 * beginGhost() snapshots the current canvas into an overlay canvas (plain
 * drawImage — no data URLs, nothing leaves memory) appended to the page
 * wrapper, and pins the wrapper to its current size so layout and scroll
 * don't jump while react-pdf re-renders underneath. endGhost() (called
 * from the page's onRenderSuccess) removes the overlay and releases the
 * pinned size. Idempotent: repeated begin calls while active are no-ops,
 * so gesture handlers can call it on every event.
 */
export function usePdfCanvasGhost(
  wrapperRef: RefObject<HTMLElement | null>,
) {
  const ghostRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(false);

  const beginGhost = useCallback(() => {
    if (activeRef.current) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const src = wrapper.querySelector<HTMLCanvasElement>(
      "canvas:not([data-pdf-ghost])",
    );
    if (!src || src.width === 0 || src.height === 0) return;

    const rect = src.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    let ghost = ghostRef.current;
    if (!ghost) {
      ghost = document.createElement("canvas");
      ghost.setAttribute("data-pdf-ghost", "true");
      ghost.setAttribute("aria-hidden", "true");
      ghost.style.position = "absolute";
      ghost.style.top = "0";
      ghost.style.left = "0";
      ghost.style.pointerEvents = "none";
      ghostRef.current = ghost;
    }
    ghost.width = src.width;
    ghost.height = src.height;
    // CSS size in layout pixels; the backing store keeps the device-pixel
    // resolution of the source so the snapshot stays sharp.
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    const ctx = ghost.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(src, 0, 0);
    wrapper.appendChild(ghost);
    // Pin the wrapper so it can't collapse to the loading node's size
    // while the canvas is unmounted (that collapse is the scroll jump).
    wrapper.style.width = `${rect.width}px`;
    wrapper.style.height = `${rect.height}px`;
    activeRef.current = true;
  }, [wrapperRef]);

  const endGhost = useCallback(() => {
    if (!activeRef.current && !ghostRef.current?.parentNode) return;
    ghostRef.current?.parentNode?.removeChild(ghostRef.current);
    const wrapper = wrapperRef.current;
    if (wrapper) {
      wrapper.style.width = "";
      wrapper.style.height = "";
    }
    activeRef.current = false;
  }, [wrapperRef]);

  return { beginGhost, endGhost };
}
