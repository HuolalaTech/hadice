/*
 _       __      _ __
| |     / /___ _(_) /____
| | /| / / __ `/ / / ___/
| |/ |/ / /_/ / / (__  )
|__/|__/\__,_/_/_/____/
The electron alternative for Go
(c) Lea Anthony 2019-present
*/

// Wails v3 事件系统兼容层
import { Events } from "@wailsio/runtime";

const eventSubscriptions = new Map();

export function LogPrint(message) {
    window.runtime.LogPrint(message);
}

export function LogTrace(message) {
    window.runtime.LogTrace(message);
}

export function LogDebug(message) {
    window.runtime.LogDebug(message);
}

export function LogInfo(message) {
    window.runtime.LogInfo(message);
}

export function LogWarning(message) {
    window.runtime.LogWarning(message);
}

export function LogError(message) {
    window.runtime.LogError(message);
}

export function LogFatal(message) {
    window.runtime.LogFatal(message);
}

// Wails v3 兼容层：使用 @wailsio/runtime/Events 的 On 函数
export function EventsOnMultiple(eventName, callback, maxCallbacks) {
    const wrappedCallback = (wailsEvent) => {
        // Wails v3 的事件对象是 WailsEvent，data 属性包含实际数据
        if (wailsEvent && wailsEvent.data !== undefined) {
            // 多参数 emit 时 data 为数组，需展开以恢复 v2 多参数行为
            if (Array.isArray(wailsEvent.data)) {
                callback(...wailsEvent.data);
            } else {
                callback(wailsEvent.data);
            }
        } else if (wailsEvent) {
            // 如果没有 data 属性，传递整个对象
            callback(wailsEvent);
        }
    };

    let unsubscribe;
    if (maxCallbacks > 0) {
        // 使用 OnMultiple 限制次数
        unsubscribe = Events.OnMultiple(eventName, wrappedCallback, maxCallbacks);
    } else {
        // maxCallbacks === -1 表示无限次，使用 On
        unsubscribe = Events.On(eventName, wrappedCallback);
    }

    if (!eventSubscriptions.has(eventName)) {
        eventSubscriptions.set(eventName, []);
    }
    eventSubscriptions.get(eventName).push(unsubscribe);

    return unsubscribe;
}

export function EventsOn(eventName, callback) {
    return EventsOnMultiple(eventName, callback, -1);
}

export function EventsOff(eventName, ...additionalEventNames) {
    const eventNames = [eventName, ...additionalEventNames];

    // 取消订阅本地保存的监听器
    for (const name of eventNames) {
        if (eventSubscriptions.has(name)) {
            const unsubscribers = eventSubscriptions.get(name);
            for (const unsubscribe of unsubscribers) {
                if (typeof unsubscribe === "function") {
                    try {
                        unsubscribe();
                    } catch (e) {
                        console.error(`Error unsubscribing from ${name}:`, e);
                    }
                }
            }
            eventSubscriptions.delete(name);
        }
    }

    // 也调用 v3 的 Off 函数
    try {
        Events.Off(...eventNames);
    } catch (e) {
        // 忽略错误
    }
}

export function EventsOffAll() {
  // 取消所有本地保存的监听器
  for (const [eventName, unsubscribers] of eventSubscriptions.entries()) {
    for (const unsubscribe of unsubscribers) {
      if (typeof unsubscribe === "function") {
        try {
          unsubscribe();
        } catch (e) {
          console.error(`Error unsubscribing from ${eventName}:`, e);
        }
      }
    }
  }
  eventSubscriptions.clear();

  // 也调用 v3 的 OffAll 函数
  try {
    Events.OffAll();
  } catch (e) {
    // 忽略错误
  }
}

export function EventsOnce(eventName, callback) {
    const wrappedCallback = (wailsEvent) => {
        if (wailsEvent && wailsEvent.data !== undefined) {
            if (Array.isArray(wailsEvent.data)) {
                callback(...wailsEvent.data);
            } else {
                callback(wailsEvent.data);
            }
        } else if (wailsEvent) {
            callback(wailsEvent);
        }
    };
    const unsubscribe = Events.Once(eventName, wrappedCallback);
    
    if (!eventSubscriptions.has(eventName)) {
        eventSubscriptions.set(eventName, []);
    }
    eventSubscriptions.get(eventName).push(unsubscribe);
    
    return unsubscribe;
}

// EventsEmit 在前端不需要实现，只在后端发送
export function EventsEmit(eventName) {
    // v3 中前端不直接 emit，这是后端的工作
    console.warn("EventsEmit from frontend is not supported in Wails v3");
}

export function WindowReload() {
    window.runtime.WindowReload();
}

export function WindowReloadApp() {
    window.runtime.WindowReloadApp();
}

export function WindowSetAlwaysOnTop(b) {
    window.runtime.WindowSetAlwaysOnTop(b);
}

export function WindowSetSystemDefaultTheme() {
    window.runtime.WindowSetSystemDefaultTheme();
}

export function WindowSetLightTheme() {
    window.runtime.WindowSetLightTheme();
}

export function WindowSetDarkTheme() {
    window.runtime.WindowSetDarkTheme();
}

export function WindowCenter() {
    window.runtime.WindowCenter();
}

export function WindowSetTitle(title) {
    window.runtime.WindowSetTitle(title);
}

export function WindowFullscreen() {
    window.runtime.WindowFullscreen();
}

export function WindowUnfullscreen() {
    window.runtime.WindowUnfullscreen();
}

export function WindowIsFullscreen() {
    return window.runtime.WindowIsFullscreen();
}

export function WindowGetSize() {
    return window.runtime.WindowGetSize();
}

export function WindowSetSize(width, height) {
    window.runtime.WindowSetSize(width, height);
}

export function WindowSetMaxSize(width, height) {
    window.runtime.WindowSetMaxSize(width, height);
}

export function WindowSetMinSize(width, height) {
    window.runtime.WindowSetMinSize(width, height);
}

export function WindowSetPosition(x, y) {
    window.runtime.WindowSetPosition(x, y);
}

export function WindowGetPosition() {
    return window.runtime.WindowGetPosition();
}

export function WindowHide() {
    window.runtime.WindowHide();
}

export function WindowShow() {
    window.runtime.WindowShow();
}

export function WindowMaximise() {
    window.runtime.WindowMaximise();
}

export function WindowToggleMaximise() {
    window.runtime.WindowToggleMaximise();
}

export function WindowUnmaximise() {
    window.runtime.WindowUnmaximise();
}

export function WindowIsMaximised() {
    return window.runtime.WindowIsMaximised();
}

export function WindowMinimise() {
    window.runtime.WindowMinimise();
}

export function WindowUnminimise() {
    window.runtime.WindowUnminimise();
}

export function WindowSetBackgroundColour(R, G, B, A) {
    window.runtime.WindowSetBackgroundColour(R, G, B, A);
}

export function ScreenGetAll() {
    return window.runtime.ScreenGetAll();
}

export function WindowIsMinimised() {
    return window.runtime.WindowIsMinimised();
}

export function WindowIsNormal() {
    return window.runtime.WindowIsNormal();
}

export function BrowserOpenURL(url) {
    window.runtime.BrowserOpenURL(url);
}

export function Environment() {
    return window.runtime.Environment();
}

export function Quit() {
    window.runtime.Quit();
}

export function Hide() {
    window.runtime.Hide();
}

export function Show() {
    window.runtime.Show();
}

export function ClipboardGetText() {
    return window.runtime.ClipboardGetText();
}

export function ClipboardSetText(text) {
    return window.runtime.ClipboardSetText(text);
}

/**
 * Callback for OnFileDrop returns a slice of file path strings when a drop is finished.
 *
 * @export
 * @callback OnFileDropCallback
 * @param {number} x - x coordinate of the drop
 * @param {number} y - y coordinate of the drop
 * @param {string[]} paths - A list of file paths.
 */

/**
 * OnFileDrop listens to drag and drop events and calls the callback with the coordinates of the drop and an array of path strings.
 *
 * @export
 * @param {OnFileDropCallback} callback - Callback for OnFileDrop returns a slice of file path strings when a drop is finished.
 * @param {boolean} [useDropTarget=true] - Only call the callback when the drop finished on an element that has the drop target style. (--wails-drop-target)
 */
export function OnFileDrop(callback, useDropTarget) {
    return window.runtime.OnFileDrop(callback, useDropTarget);
}

/**
 * OnFileDropOff removes the drag and drop listeners and handlers.
 */
export function OnFileDropOff() {
    return window.runtime.OnFileDropOff();
}

export function CanResolveFilePaths() {
    return window.runtime.CanResolveFilePaths();
}

export function ResolveFilePaths(files) {
    return window.runtime.ResolveFilePaths(files);
}