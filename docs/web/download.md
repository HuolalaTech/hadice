# 下载 Hadice

<DownloadCards />

## macOS 安装

### 1. 下载对应芯片的 DMG

Apple Silicon 选 arm64 包，Intel 选 x64 包。

### 2. 安装应用

双击 DMG，把 Hadice.app 拖入 Applications 文件夹。

### 3. 解除「无法打开」或「已损坏」提示

本应用未签名，首次打开前需要在终端执行以下命令（**必要**）：

```bash
sudo xattr -dr com.apple.quarantine /Applications/Hadice.app
```

输入 Mac 登录密码后按回车。

### 4. 重新打开 Hadice

即可正常启动。

## Windows 安装版

### 1. 下载 EXE 安装包

选择 Windows x64 安装包。

### 2. 运行安装向导

按安装向导完成安装即可。

### 3. 处理 SmartScreen 提示

若提示未知应用，选择「仍要运行」。

## Windows 免安装版

下载 Windows x64 ZIP，解压后打开其中的 `Hadice` 文件夹，双击 `Hadice.exe` 即可运行。请保留同目录的 `bin` 和 `resources` 文件夹；设备工具与 Android 抓包 Agent 都在其中。

免安装版使用系统中的 WebView2 Runtime；如果电脑尚未安装，请先安装该运行时，或使用上方的 Windows 安装版。

> 下载或安装遇到问题？
> [到 GitHub 提 Issue](https://github.com/HuolalaTech/hadice/issues)
