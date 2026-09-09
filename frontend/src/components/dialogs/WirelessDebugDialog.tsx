import React, { useEffect, useMemo, useState } from "react";
import { HelpCircle, Loader2, Wifi, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useDeviceStore } from "@/store/deviceStore";
import { captureEvent, capturePostHogException } from "@/lib/posthog";
import type { Device, Platform } from "@/types/hdc";
import * as App from "../../../bindings/Hadice/backend/appservice";

const WIRELESS_ADDRESS_PLACEHOLDER = "192.168.1.50:36000";
const FULLWIDTH_COLON_ERROR =
  "IP地址和端口中不能使用中文冒号，请使用英文冒号 :";

interface WirelessDebugDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface WirelessDebugResult {
  success: boolean;
  output: string;
  error?: string;
  connectKey?: string;
  platform: Platform | string;
}

function getDeviceName(device: Device): string {
  if (device.productName) {
    return device.model
      ? `${device.productName} (${device.model})`
      : device.productName;
  }
  return device.model || device.connectKey;
}

export function WirelessDebugDialog({
  open,
  onOpenChange,
}: WirelessDebugDialogProps): React.JSX.Element {
  const refreshDevices = useDeviceStore((s) => s.refreshDevices);
  const selectDevice = useDeviceStore((s) => s.selectDevice);

  const [platform, setPlatform] = useState<Platform>("android");
  const [androidAddress, setAndroidAddress] = useState("");
  const [harmonyAddress, setHarmonyAddress] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "success" | "error">(
    "info",
  );
  const [output, setOutput] = useState("");

  const currentAddress =
    platform === "android" ? androidAddress : harmonyAddress;
  const hasFullwidthColon = currentAddress.includes("：");

  useEffect(() => {
    if (hasFullwidthColon) {
      setMessageState(FULLWIDTH_COLON_ERROR, "error");
      setOutput("");
    } else if (message === FULLWIDTH_COLON_ERROR) {
      setMessage("");
    }
  }, [hasFullwidthColon, message]);

  const canSubmit = useMemo(() => {
    if (hasFullwidthColon) {
      return false;
    }
    if (platform === "android") {
      return Boolean(androidAddress.trim());
    }
    return Boolean(harmonyAddress.trim());
  }, [platform, androidAddress, harmonyAddress, hasFullwidthColon]);

  const selectConnectedDevice = async (
    result: WirelessDebugResult,
  ): Promise<void> => {
    await refreshDevices();
    const devices = useDeviceStore.getState().devices;
    const connected = devices.find(
      (device) =>
        device.connectKey === result.connectKey &&
        device.status === "Connected",
    );
    if (connected) {
      selectDevice(connected);
      setMessageState(`已连接 ${getDeviceName(connected)}`, "success");
    } else {
      setMessageState("连接命令已完成，请刷新设备列表确认状态", "success");
    }
  };

  const setMessageState = (
    text: string,
    type: "info" | "success" | "error",
  ): void => {
    setMessage(text);
    setMessageType(type);
  };

  const handleAddressChange = (value: string): void => {
    if (platform === "android") {
      setAndroidAddress(value);
    } else {
      setHarmonyAddress(value);
    }

    if (value.includes("：")) {
      setMessageState(FULLWIDTH_COLON_ERROR, "error");
      setOutput("");
    } else if (message === FULLWIDTH_COLON_ERROR) {
      setMessage("");
    }
  };

  const handleSubmit = async (): Promise<void> => {
    if (hasFullwidthColon) {
      setMessageState(FULLWIDTH_COLON_ERROR, "error");
      return;
    }

    if (!canSubmit || isConnecting) {
      return;
    }

    setIsConnecting(true);
    setMessageState("正在连接无线调试设备...", "info");
    setOutput("");

    try {
      const result = (await App.ConnectWirelessDebugDevice({
        platform,
        mode: "connectOnly",
        host: "",
        pairPort: "",
        pairCode: "",
        connectPort: "",
        address:
          platform === "android"
            ? androidAddress.trim()
            : harmonyAddress.trim(),
      })) as WirelessDebugResult;

      setOutput(result.output || result.error || "");

      if (result.success) {
        captureEvent("wireless debug connected", {
          platform,
          mode: platform === "android" ? "adb connect" : "tconn",
        });
        await selectConnectedDevice(result);
        window.setTimeout(() => onOpenChange(false), 500);
      } else {
        setMessageState(
          result.error || result.output || "无线调试连接失败",
          "error",
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        capturePostHogException(error, {
          feature: "device",
          action: "wireless_debug_connect",
        });
      }
      setMessageState(
        error instanceof Error ? error.message : "无线调试连接失败",
        "error",
      );
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl [&>button]:hidden">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5" />
            无线调试
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <Tabs
          value={platform}
          onValueChange={(value) => setPlatform(value as Platform)}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="android">安卓 ADB</TabsTrigger>
            <TabsTrigger value="harmonyos">鸿蒙 HDC</TabsTrigger>
          </TabsList>

          <TabsContent value="android" className="space-y-4 pt-2">
            <label className="space-y-1.5">
              <span className="text-sm font-medium">IP地址和端口</span>
              <Input
                value={androidAddress}
                onChange={(event) => handleAddressChange(event.target.value)}
                placeholder={WIRELESS_ADDRESS_PLACEHOLDER}
                autoComplete="off"
              />
            </label>
          </TabsContent>

          <TabsContent value="harmonyos" className="space-y-4 pt-2">
            <label className="space-y-1.5">
              <span className="text-sm font-medium">IP地址和端口</span>
              <Input
                value={harmonyAddress}
                onChange={(event) => handleAddressChange(event.target.value)}
                placeholder={WIRELESS_ADDRESS_PLACEHOLDER}
                autoComplete="off"
              />
            </label>
          </TabsContent>
        </Tabs>

        {message && (
          <div className="flex items-start gap-2 rounded-md border bg-secondary/30 px-3 py-2">
            <Badge
              variant={
                messageType === "success"
                  ? "success"
                  : messageType === "error"
                    ? "destructive"
                    : "outline"
              }
            >
              {messageType === "success"
                ? "成功"
                : messageType === "error"
                  ? "失败"
                  : "状态"}
            </Badge>
            <div className="min-w-0 flex-1 text-sm">{message}</div>
          </div>
        )}

        {output && (
          <pre className="max-h-28 overflow-auto rounded-md bg-secondary/30 p-3 text-xs text-muted-foreground">
            {output}
          </pre>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isConnecting}
          >
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || isConnecting}
            className="gap-2"
          >
            {isConnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wifi className="h-4 w-4" />
            )}
            连接
          </Button>
        </div>

        <div className="flex gap-2 rounded-md border bg-secondary/20 px-3 py-2 text-sm text-muted-foreground">
          <HelpCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="space-y-1">
            <div>
              1. 打开安卓/鸿蒙设备的设置 - 开发者选项 -
              无线调试，打开开关并弹窗确认。
            </div>
            <div>2. 无线调试页面会显示“IP地址和端口”。</div>
            <div>3. 将该内容填入上方“IP地址和端口”输入框后点击连接。</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
