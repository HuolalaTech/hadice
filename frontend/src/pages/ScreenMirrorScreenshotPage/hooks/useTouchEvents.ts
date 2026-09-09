import { useCallback, useRef } from "react";
import { isHdcAvailable } from "@/lib/hdc";

interface TouchPosition {
  x: number;
  y: number;
}

type CoordinateConverter = (
  clientX: number,
  clientY: number,
) => { x: number; y: number } | null;

/**
 * 触摸事件处理 Hook
 *
 * 使用实时触摸事件：TouchDown -> TouchMove -> TouchUp
 * 支持滚轮滚动事件
 */
export function useTouchEvents(
  selectedDevice: { connectKey: string } | null,
  isStreaming: boolean,
  convertToDeviceCoordinates: CoordinateConverter,
) {
  const touchStartRef = useRef<TouchPosition | null>(null);
  const isDraggingRef = useRef(false);
  const lastMoveRef = useRef<TouchPosition | null>(null);
  const moveThrottleTimerRef = useRef<number | null>(null);

  const DRAG_THRESHOLD = 5;
  const MOVE_THROTTLE_MS = 16;

  const sendTouchDown = useCallback(async (x: number, y: number) => {
    if (!selectedDevice || !isHdcAvailable()) return;
    try {
      await window.hdc.screenMirror.touchDown(selectedDevice.connectKey, x, y);
    } catch (err) {
      // 静默处理错误
    }
  }, [selectedDevice]);

  const sendTouchMove = useCallback(async (x: number, y: number) => {
    if (!selectedDevice || !isHdcAvailable()) return;
    try {
      await window.hdc.screenMirror.touchMove(selectedDevice.connectKey, x, y);
    } catch (err) {
      // 静默处理错误
    }
  }, [selectedDevice]);

  const sendTouchUp = useCallback(async (x: number, y: number) => {
    if (!selectedDevice || !isHdcAvailable()) return;
    try {
      await window.hdc.screenMirror.touchUp(selectedDevice.connectKey, x, y);
    } catch (err) {
      // 静默处理错误
    }
  }, [selectedDevice]);

  const handleMouseDown = useCallback(
    async (event: React.MouseEvent<HTMLImageElement | HTMLCanvasElement>) => {
      // 必须在第一个 await 之前阻止浏览器的原生选择/拖拽行为。
      event.preventDefault();
      if (!selectedDevice || !isHdcAvailable() || !isStreaming) {
        return;
      }

      const coords = convertToDeviceCoordinates(event.clientX, event.clientY);
      if (!coords) {
        return;
      }

      isDraggingRef.current = false;
      touchStartRef.current = { x: coords.x, y: coords.y };
      lastMoveRef.current = { x: coords.x, y: coords.y };

      await sendTouchDown(coords.x, coords.y);

    },
    [selectedDevice, isStreaming, convertToDeviceCoordinates, sendTouchDown],
  );

  const handleMouseMove = useCallback(
    async (event: React.MouseEvent<HTMLImageElement | HTMLCanvasElement>) => {
      if (!touchStartRef.current || !selectedDevice || !isHdcAvailable() || !isStreaming) {
        return;
      }

      const coords = convertToDeviceCoordinates(event.clientX, event.clientY);
      if (!coords) {
        return;
      }

      const deltaX = Math.abs(coords.x - touchStartRef.current.x);
      const deltaY = Math.abs(coords.y - touchStartRef.current.y);

      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        isDraggingRef.current = true;
      }

      if (isDraggingRef.current) {
        if (moveThrottleTimerRef.current !== null) {
          return;
        }

        moveThrottleTimerRef.current = window.setTimeout(() => {
          moveThrottleTimerRef.current = null;
        }, MOVE_THROTTLE_MS);

        if (
          lastMoveRef.current &&
          (coords.x !== lastMoveRef.current.x || coords.y !== lastMoveRef.current.y)
        ) {
          await sendTouchMove(coords.x, coords.y);
          lastMoveRef.current = { x: coords.x, y: coords.y };
        }
      }

      event.preventDefault();
    },
    [selectedDevice, isStreaming, convertToDeviceCoordinates, sendTouchMove],
  );

  const handleMouseUp = useCallback(
    async (event: React.MouseEvent<HTMLImageElement | HTMLCanvasElement>) => {
      if (!touchStartRef.current || !selectedDevice || !isHdcAvailable() || !isStreaming) {
        return;
      }

      const coords = convertToDeviceCoordinates(event.clientX, event.clientY);
      const releaseCoords = coords || lastMoveRef.current;
      if (releaseCoords) {
        await sendTouchUp(releaseCoords.x, releaseCoords.y);
      }

      if (moveThrottleTimerRef.current !== null) {
        window.clearTimeout(moveThrottleTimerRef.current);
        moveThrottleTimerRef.current = null;
      }

      touchStartRef.current = null;
      isDraggingRef.current = false;
      lastMoveRef.current = null;

      event.preventDefault();
    },
    [selectedDevice, isStreaming, convertToDeviceCoordinates, sendTouchUp],
  );

  const handleMouseLeave = useCallback(async () => {
    if (touchStartRef.current && lastMoveRef.current) {
      await sendTouchUp(lastMoveRef.current.x, lastMoveRef.current.y);
    }
    if (moveThrottleTimerRef.current !== null) {
      window.clearTimeout(moveThrottleTimerRef.current);
      moveThrottleTimerRef.current = null;
    }
    touchStartRef.current = null;
    isDraggingRef.current = false;
    lastMoveRef.current = null;
  }, [sendTouchUp]);

  const handleTouchStart = useCallback(
    async (event: React.TouchEvent<HTMLImageElement | HTMLCanvasElement>) => {
      event.preventDefault();
      if (!selectedDevice || !isHdcAvailable() || !isStreaming) {
        return;
      }

      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      const coords = convertToDeviceCoordinates(touch.clientX, touch.clientY);
      if (!coords) {
        return;
      }

      isDraggingRef.current = false;
      touchStartRef.current = { x: coords.x, y: coords.y };
      lastMoveRef.current = { x: coords.x, y: coords.y };

      await sendTouchDown(coords.x, coords.y);

    },
    [selectedDevice, isStreaming, convertToDeviceCoordinates, sendTouchDown],
  );

  const handleTouchMove = useCallback(
    async (event: React.TouchEvent<HTMLImageElement | HTMLCanvasElement>) => {
      if (!touchStartRef.current || !selectedDevice || !isHdcAvailable() || !isStreaming) {
        return;
      }

      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      const coords = convertToDeviceCoordinates(touch.clientX, touch.clientY);
      if (!coords) {
        return;
      }

      const deltaX = Math.abs(coords.x - touchStartRef.current.x);
      const deltaY = Math.abs(coords.y - touchStartRef.current.y);

      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        isDraggingRef.current = true;
      }

      if (isDraggingRef.current) {
        if (moveThrottleTimerRef.current !== null) {
          return;
        }

        moveThrottleTimerRef.current = window.setTimeout(() => {
          moveThrottleTimerRef.current = null;
        }, MOVE_THROTTLE_MS);

        if (
          lastMoveRef.current &&
          (coords.x !== lastMoveRef.current.x || coords.y !== lastMoveRef.current.y)
        ) {
          await sendTouchMove(coords.x, coords.y);
          lastMoveRef.current = { x: coords.x, y: coords.y };
        }
      }

      event.preventDefault();
    },
    [selectedDevice, isStreaming, convertToDeviceCoordinates, sendTouchMove],
  );

  const handleTouchEnd = useCallback(
    async (event: React.TouchEvent<HTMLImageElement | HTMLCanvasElement>) => {
      if (!touchStartRef.current || !selectedDevice || !isHdcAvailable() || !isStreaming) {
        return;
      }

      const touch = event.changedTouches[0];
      if (!touch) {
        touchStartRef.current = null;
        isDraggingRef.current = false;
        lastMoveRef.current = null;
        return;
      }

      const coords = convertToDeviceCoordinates(touch.clientX, touch.clientY);
      const releaseCoords = coords || lastMoveRef.current;
      if (releaseCoords) {
        await sendTouchUp(releaseCoords.x, releaseCoords.y);
      }

      if (moveThrottleTimerRef.current !== null) {
        window.clearTimeout(moveThrottleTimerRef.current);
        moveThrottleTimerRef.current = null;
      }

      touchStartRef.current = null;
      isDraggingRef.current = false;
      lastMoveRef.current = null;

      event.preventDefault();
    },
    [selectedDevice, isStreaming, convertToDeviceCoordinates, sendTouchUp],
  );

  const handleTouchCancel = useCallback(
    async (_event: React.TouchEvent<HTMLImageElement | HTMLCanvasElement>) => {
      if (touchStartRef.current && lastMoveRef.current) {
        await sendTouchUp(lastMoveRef.current.x, lastMoveRef.current.y);
      }
      if (moveThrottleTimerRef.current !== null) {
        window.clearTimeout(moveThrottleTimerRef.current);
        moveThrottleTimerRef.current = null;
      }
      touchStartRef.current = null;
      isDraggingRef.current = false;
      lastMoveRef.current = null;
    },
    [sendTouchUp],
  );

  const handleWheel = useCallback(
    async (event: React.WheelEvent<HTMLImageElement | HTMLCanvasElement>) => {
      if (!selectedDevice || !isHdcAvailable() || !isStreaming) {
        return;
      }

      const coords = convertToDeviceCoordinates(event.clientX, event.clientY);
      if (!coords) {
        return;
      }

      const vscroll = event.deltaY > 0 ? -1 : event.deltaY < 0 ? 1 : 0;
      const hscroll = event.deltaX > 0 ? 1 : event.deltaX < 0 ? -1 : 0;

      if (vscroll !== 0 || hscroll !== 0) {
        try {
          await window.hdc.screenMirror.scroll(
            selectedDevice.connectKey,
            coords.x,
            coords.y,
            hscroll,
            vscroll,
          );
        } catch (err) {
          // 静默处理错误
        }
      }

      event.preventDefault();
    },
    [selectedDevice, isStreaming, convertToDeviceCoordinates],
  );

  const handleImageClick = useCallback(
    async (event: React.MouseEvent<HTMLImageElement>) => {
      // 点击事件已由 handleMouseUp 处理，此处保留兼容
    },
    [],
  );

  return {
    handleImageClick,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    handleWheel,
  };
}
