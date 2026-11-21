# Third-party notices / Fremde Komponenten

**English:** The GutKeeper server and web app use no third-party libraries (Node.js built-ins only). Third-party code is only included in the **Android app** (APK) and the **Docker image**. All of these licenses are compatible with the AGPL-3.0.

**Deutsch:** Server und Web-App von GutKeeper kommen ohne fremde Bibliotheken aus (nur Node.js-Bordmittel). Fremder Code steckt nur in der **Android-App** (APK) und im **Docker-Image**. Alle diese Lizenzen sind mit der AGPL-3.0 vereinbar.

## Android app (APK)

| Komponente / Component | Lizenz / License | Copyright |
|---|---|---|
| [@capacitor/core](https://github.com/ionic-team/capacitor), [@capacitor/android](https://github.com/ionic-team/capacitor) | MIT | Copyright (c) 2017-present Drifty Co. |
| [@capacitor/app](https://github.com/ionic-team/capacitor-plugins), [@capacitor/share](https://github.com/ionic-team/capacitor-plugins) | MIT | Copyright 2020-present Ionic |
| [@capacitor/filesystem](https://github.com/ionic-team/capacitor-filesystem) | MIT | Copyright (c) 2025 Ionic |
| [ionfilesystem-android](https://github.com/ionic-team/ion-android-filesystem) | MIT | Ionic |
| [@aparajita/capacitor-biometric-auth](https://github.com/aparajita/capacitor-biometric-auth) | MIT | Copyright 2020-present Aparajita Fishman |
| [@capacitor-community/privacy-screen](https://github.com/capacitor-community/privacy-screen) | MIT | Copyright (c) 2021 Robin Genz |
| AndroidX (appcompat, core, activity, fragment, coordinatorlayout, splashscreen, biometric, webkit u. a.), Material Components for Android | Apache-2.0 | The Android Open Source Project / Google LLC |
| Apache Cordova Android (von Capacitor eingebunden) | Apache-2.0 | The Apache Software Foundation |
| Kotlin Standard Library, kotlinx.coroutines | Apache-2.0 | JetBrains s.r.o. and Kotlin Programming Language contributors |

Die eigenen Plugins `AppIcon` und `ImageSaver` (Java, in `android-app/android/app/src/main/java/`) gehören zu GutKeeper und stehen unter der AGPL-3.0. / The own plugins `AppIcon` and `ImageSaver` (Java) are part of GutKeeper and licensed under the AGPL-3.0.

### MIT License

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Apache License 2.0

Volltext / full text: <https://www.apache.org/licenses/LICENSE-2.0>

## Docker image

Das Image baut auf dem offiziellen Image [`node:24-alpine`](https://hub.docker.com/_/node) auf. Es enthält Node.js (MIT; die Lizenzen seiner Bestandteile liegen der Node-Distribution bei) und Alpine Linux mit seinen Paketen (jeweils unter eigener Lizenz).

The image is based on the official [`node:24-alpine`](https://hub.docker.com/_/node) image. It contains Node.js (MIT, with the licenses of its components shipped in the Node distribution) and Alpine Linux with its packages (each under its own license).
