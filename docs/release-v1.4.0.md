# Image MetaHub v1.4.0

## [1.4.0] - 2025-09-17

### Added

- **File Management**: Added rename and delete functionality for image files (Electron app only)
- **Rename Files**: Click rename button in image modal to change filename with validation
- **Delete Files**: Delete images with confirmation dialog, files are moved to system trash/recycle bin
- **File Operations**: Added secure IPC communication between renderer and main process for file operations

### UI Improvements

- Added rename and delete buttons in image detail modal with clear icons and colors
- Rename dialog with inline text input and validation feedback
- Confirmation dialogs for destructive operations
- Disabled state management during operations to prevent conflicts

### Technical

- Created fileOperations service for handling file management
- Enhanced Electron IPC handlers with proper file path resolution
- Added proper error handling and user feedback for file operations
- File operations are desktop-only for security reasons

## Downloads

Choose the appropriate installer for your operating system:

###  Windows
- **Installer**: `ImageMetaHub-Setup-1.4.0.exe`
- **Format**: NSIS installer with desktop and start menu shortcuts
- **Size**: ~85MB

###  macOS
- **Intel Macs**: `ImageMetaHub-1.4.0.dmg`
- **Apple Silicon**: `ImageMetaHub-1.4.0-arm64.dmg`
- **Format**: DMG packages with proper entitlements
- **Requirements**: macOS 10.15+

###  Linux
- **Universal**: `ImageMetaHub-1.4.0.AppImage`
- **Format**: Portable AppImage (no installation required)
- **Dependencies**: None (fully self-contained)

## System Requirements

- **OS**: Windows 10+, macOS 10.15+, Ubuntu 18.04+ (or equivalent)
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 100MB for application + space for your image collections

## Documentation

- [README](https://github.com/skkut/SilkStack-Image-Browser/blob/main/README.md)
- [Architecture](https://github.com/skkut/SilkStack-Image-Browser/blob/main/docs/ARCHITECTURE.md)
- [Changelog](https://github.com/skkut/SilkStack-Image-Browser/blob/main/docs/CHANGELOG.md)

## Known Issues

- Safari, Firefox, and Brave browsers don't support the File System Access API on macOS
- Use Chrome, Vivaldi, Edge, or the Desktop App for full functionality

## Feedback

Found a bug or have a feature request? [Open an issue](https://github.com/skkut/SilkStack-Image-Browser/issues)!

---

*Released on 2026-05-26*