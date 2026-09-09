# Download Hadice

<DownloadCards />

## macOS installation

### 1. Download the DMG for your chip

Pick the arm64 package on Apple Silicon, or the x64 package on Intel.

### 2. Install the app

Double-click the DMG and drag Hadice.app into the Applications folder.

### 3. Bypass the "unidentified developer" / "damaged" warning

The app is unsigned, so before the first launch you need to run this command in Terminal (**required**):

```bash
sudo xattr -dr com.apple.quarantine /Applications/Hadice.app
```

Enter your Mac login password and press Return.

### 4. Reopen Hadice

The app should now start normally.

## Windows installation

### 1. Download the EXE installer

Choose the Windows x64 installer.

### 2. Run the setup wizard

Follow the installer wizard to finish.

### 3. Handle the SmartScreen prompt

If Windows warns about an unknown app, choose "Run anyway".

> Having trouble downloading or installing?
> [Open an issue on GitHub](https://github.com/HuolalaTech/hadice/issues)
