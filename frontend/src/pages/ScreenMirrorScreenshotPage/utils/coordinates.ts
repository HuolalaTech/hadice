/**
 * 将屏幕坐标转换为设备坐标
 *
 * 重要说明：
 * 1. 渲染组件宽高：元素 getBoundingClientRect().width/height（CSS 像素）
 * 2. 视频流宽高：img 用 naturalWidth/Height；canvas 用 width/height（解码分辨率）
 * 3. 设备实际宽高：displaySize.width/height（通过 hdc / wm size 等获取）
 *
 * 坐标转换逻辑：
 * - 屏幕坐标 → 渲染组件相对坐标（考虑边框）
 * - 渲染组件相对坐标 → 视频流坐标
 * - 视频流坐标 → 设备实际坐标（使用 displaySize）
 *
 * 关键点：
 * - 使用视频流的实际尺寸（streamWidth/streamHeight）计算第一层缩放
 * - 然后映射到设备实际尺寸
 * - 处理 object-fit: contain 导致的黑边
 */
export function createCoordinateConverter(
  surfaceRef: React.RefObject<HTMLImageElement | HTMLCanvasElement | null>,
  displaySize: { width: number; height: number } | null,
) {
  return (
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null => {
    if (!surfaceRef.current) {
      return null;
    }

    const el = surfaceRef.current;
    const rect = el.getBoundingClientRect();

    // 1. 获取并去除边框
    const computedStyle = window.getComputedStyle(el);
    const borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0;
    const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
    const borderRight = parseFloat(computedStyle.borderRightWidth) || 0;
    const borderBottom = parseFloat(computedStyle.borderBottomWidth) || 0;

    const displayLeft = rect.left + borderLeft;
    const displayTop = rect.top + borderTop;
    const displayWidth = rect.width - borderLeft - borderRight;
    const displayHeight = rect.height - borderTop - borderBottom;

    // 2. 获取视频流的实际像素尺寸
    // 对于 canvas：width/height 是像素尺寸
    // 对于 img：naturalWidth/naturalHeight 是图片原始尺寸
    const streamWidth =
      el instanceof HTMLCanvasElement ? el.width : el.naturalWidth;
    const streamHeight =
      el instanceof HTMLCanvasElement ? el.height : el.naturalHeight;

    if (streamWidth <= 0 || streamHeight <= 0) {
      return null;
    }

    // 3. 获取设备实际尺寸（用于最终映射）
    const deviceWidth = displaySize?.width || streamWidth;
    const deviceHeight = displaySize?.height || streamHeight;

    // 4. 检查点击是否在显示区域内
    if (
      clientX < displayLeft ||
      clientX > displayLeft + displayWidth ||
      clientY < displayTop ||
      clientY > displayTop + displayHeight
    ) {
      return null;
    }

    // 5. 计算相对于显示区域的坐标（CSS 像素）
    let relativeX = clientX - displayLeft;
    let relativeY = clientY - displayTop;

    // 6. 计算 canvas/img 的实际渲染尺寸（考虑 object-fit: contain）
    // CSS 尺寸可能和视频流尺寸比例不同，需要计算实际渲染区域
    const streamAspectRatio = streamWidth / streamHeight;
    const displayAspectRatio = displayWidth / displayHeight;

    let actualDisplayWidth = displayWidth;
    let actualDisplayHeight = displayHeight;
    let offsetX = 0;
    let offsetY = 0;

    if (streamAspectRatio > displayAspectRatio) {
      // 视频流更宽，左右有黑边
      actualDisplayHeight = displayWidth / streamAspectRatio;
      offsetY = (displayHeight - actualDisplayHeight) / 2;
    } else {
      // 视频流更高，上下有黑边
      actualDisplayWidth = displayHeight * streamAspectRatio;
      offsetX = (displayWidth - actualDisplayWidth) / 2;
    }

    // 7. 检查是否在实际视频区域内（排除黑边）
    if (
      relativeX < offsetX ||
      relativeX > offsetX + actualDisplayWidth ||
      relativeY < offsetY ||
      relativeY > offsetY + actualDisplayHeight
    ) {
      return null;
    }

    // 8. 计算相对于实际视频区域的坐标
    const videoRelativeX = relativeX - offsetX;
    const videoRelativeY = relativeY - offsetY;

    // 9. 直接映射到设备坐标（不再使用 streamWidth/streamHeight 中间步骤）
    // 因为 streamWidth/streamHeight 和 deviceWidth/deviceHeight 比例相同
    const deviceX = (videoRelativeX / actualDisplayWidth) * deviceWidth;
    const deviceY = (videoRelativeY / actualDisplayHeight) * deviceHeight;

    // 10. 四舍五入并边界检查
    const finalX = Math.round(deviceX);
    const finalY = Math.round(deviceY);

    if (finalX < 0 || finalY < 0 || finalX > deviceWidth || finalY > deviceHeight) {
      return null;
    }

    // 调试日志（取消注释以调试）
    // console.log("[坐标转换]", {
    //   client: { x: clientX, y: clientY },
    //   display: { width: displayWidth, height: displayHeight },
    //   stream: { width: streamWidth, height: streamHeight },
    //   device: { width: deviceWidth, height: deviceHeight },
    //   actualVideo: {
    //     width: actualDisplayWidth,
    //     height: actualDisplayHeight,
    //     offsetX,
    //     offsetY,
    //   },
    //   videoRelative: { x: videoRelativeX, y: videoRelativeY },
    //   result: { x: finalX, y: finalY },
    // });

    return { x: finalX, y: finalY };
  };
}
