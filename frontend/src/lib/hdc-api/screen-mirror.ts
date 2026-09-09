/**
 * 屏幕投屏相关 API
 */

import * as App from "../../../bindings/Hadice/backend/appservice";
import { EventsOn } from "../../../wailsjs/runtime/runtime";
import type { ScreenMirrorStatus, DisplaySize } from "@/types/hdc";

/**
 * 屏幕投屏相关 API
 */
export const screenMirrorAPI = {
  start: async (
    connectKey: string,
    scale: number = 0.75,
  ): Promise<{ success: boolean; error?: string; transport?: string }> => {
    try {
      const result = await App.StartScreenMirror(connectKey, scale);
      return {
        success: result.success === true,
        error: result.error,
        transport: result.transport,
      };
    } catch (error) {
      console.error("[HDC API] screenMirror.start failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  stop: async (
    connectKey: string,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await App.StopScreenMirror(connectKey);
      return { success: result.success === true, error: result.error };
    } catch (error) {
      console.error("[HDC API] screenMirror.stop failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  getStatus: async (_connectKey: string): Promise<ScreenMirrorStatus> => {
    // TODO: 实现获取状态的方法
    return { isStreaming: false, deviceSn: _connectKey };
  },

  click: async (
    connectKey: string,
    x: number,
    y: number,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      // 直接使用 Click 方法（内部调用 uitest uiInput click）
      const result = await App.Click(connectKey, x, y);
      return { success: result.success === true, error: result.error };
    } catch (error) {
      console.error("[HDC API] screenMirror.click failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  swipe: async (
    connectKey: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    duration: number,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      // duration 映射到 uinput smoothTime，限制在 1~15000ms
      const smoothTime = Math.min(
        Math.max(Math.floor(duration || 1), 1),
        15000,
      );
      const result = await App.TouchMoveFromTo(
        connectKey,
        x1,
        y1,
        x2,
        y2,
        smoothTime,
      );
      return { success: result.success === true, error: result.error };
    } catch (error) {
      console.error("[HDC API] screenMirror.swipe failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  pressBack: async (
    connectKey: string,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await App.PressBack(connectKey);
      return { success: result.success === true, error: result.error };
    } catch (error) {
      console.error("[HDC API] screenMirror.pressBack failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  pressHome: async (
    connectKey: string,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await App.PressHome(connectKey);
      return { success: result.success === true, error: result.error };
    } catch (error) {
      console.error("[HDC API] screenMirror.pressHome failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  pressKey: async (
    connectKey: string,
    keyCode: number,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await App.PressKey(connectKey, keyCode);
      return { success: result.success === true, error: result.error };
    } catch (error) {
      console.error("[HDC API] screenMirror.pressKey failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  getDisplaySize: async (
    connectKey: string,
  ): Promise<{ success: boolean; size?: DisplaySize; error?: string }> => {
    try {
      const size = await App.GetDisplaySize(connectKey);
      return {
        success: true,
        size: { width: size.width, height: size.height },
      };
    } catch (error) {
      console.error("[HDC API] screenMirror.getDisplaySize failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  touchDown: async (
    connectKey: string,
    x: number,
    y: number,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await App.TouchDown(connectKey, x, y);
      return { success: result.success === true, error: result.error };
    } catch (error) {
      console.error("[HDC API] screenMirror.touchDown failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  touchMove: async (
    connectKey: string,
    x: number,
    y: number,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await App.TouchMove(connectKey, x, y);
      return { success: result.success === true, error: result.error };
    } catch (error) {
      console.error("[HDC API] screenMirror.touchMove failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  touchUp: async (
    connectKey: string,
    x: number,
    y: number,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await App.TouchUp(connectKey, x, y);
      return { success: result.success === true, error: result.error };
    } catch (error) {
      console.error("[HDC API] screenMirror.touchUp failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  touchMoveFromTo: async (
    connectKey: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    duration: number,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await App.TouchMoveFromTo(
        connectKey,
        x1,
        y1,
        x2,
        y2,
        duration,
      );
      return { success: result.success === true, error: result.error };
    } catch (error) {
      console.error("[HDC API] screenMirror.touchMoveFromTo failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  scroll: async (
    connectKey: string,
    x: number,
    y: number,
    hscroll: number,
    vscroll: number,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await App.Scroll(connectKey, x, y, hscroll, vscroll);
      return { success: result.success === true, error: result.error };
    } catch (error) {
      console.error("[HDC API] screenMirror.scroll failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  onFrame: (
    callback: (deviceSn: string, frameDataBase64: string, isKeyframe?: boolean, isConfig?: boolean, pts?: number, transport?: string) => void,
  ): (() => void) => {
    return EventsOn("screenMirror:frame", (eventData: any) => {
      const sn =
        eventData?.deviceSn ?? eventData?.DeviceSn ?? eventData?.device_sn;
      const data = eventData?.data ?? eventData?.Data;
      const isKeyframe = Boolean(
        eventData?.isKeyframe ?? eventData?.IsKeyframe ?? eventData?.is_keyframe,
      );
      const isConfig = Boolean(
        eventData?.isConfig ?? eventData?.IsConfig ?? eventData?.is_config,
      );
      const ptsRaw =
        eventData?.pts ?? eventData?.Pts ?? eventData?.PTS ?? 0;
      const pts =
        typeof ptsRaw === "bigint"
          ? Number(ptsRaw)
          : Number(ptsRaw) || 0;
      const transport =
        eventData?.transport ??
        eventData?.Transport ??
        (eventData?.isConfig !== undefined || eventData?.isKeyframe !== undefined
          ? 'h264'
          : 'jpeg');
      callback(sn, data, isKeyframe, isConfig, pts, transport);
    });
  },

  onCodec: (
    callback: (deviceSn: string, codecInfo: { codecId: number; width: number; height: number; transport?: string }) => void,
  ): (() => void) => {
    return EventsOn("screenMirror:codec", (eventData: any) => {
      const sn =
        eventData?.deviceSn ?? eventData?.DeviceSn ?? eventData?.device_sn;
      const codecId = Number(
        eventData?.codecId ?? eventData?.CodecId ?? eventData?.codec_id ?? 0,
      );
      const width = Number(
        eventData?.width ?? eventData?.Width ?? 0,
      );
      const height = Number(
        eventData?.height ?? eventData?.Height ?? 0,
      );
      const transport = eventData?.transport ?? eventData?.Transport;
      callback(sn, { codecId, width, height, transport });
    });
  },

  onError: (
    callback: (deviceSn: string, errorMsg: string) => void,
  ): (() => void) => {
    return EventsOn("screenMirror:error", (eventData: any) => {
      callback(eventData.deviceSn, eventData.error);
    });
  },
};
